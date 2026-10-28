package checkpoint

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

// The inspected FluxFusion checkpoint is an exact artifact, not a model-family
// alias. These values came from a read-only file and header inspection on
// 2026-10-28. Replacing it needs a new reviewed spec and a new parity record.
var fusionNF4 = Spec{
	FileBytes:        12340984756,
	ContentSHA256:    "c439ae8b57e2632477dc4a9e55e715bceb3b5ec01f9d47c5753110d630479cec",
	DescriptorSHA256: "f595badabaa5dd96ebe631c434b3f8a572edf687e118034b724afc0cf1a2c422",
	TensorCount:      2374,
	NF4Weights:       312,
	PrefixCounts:     map[string]int{"model.": 1712, "text_encoders.": 418, "vae.": 244},
}

// Spec pins one reviewed safetensors artifact. DescriptorSHA256 hashes one
// line per sorted tensor: name, tab, safetensors dtype, tab, comma-joined
// decimal shape, newline. ContentSHA256 hashes the entire file. Both hashes
// are required; PrefixCounts is an optional human-readable family check.
type Spec struct {
	FileBytes        int64
	ContentSHA256    string
	DescriptorSHA256 string
	TensorCount      int
	NF4Weights       int
	PrefixCounts     map[string]int
}

// OpenFusionNF4 proves the complete artifact digest, every tensor's name,
// dtype and shape, and every NF4 partner before returning an offline reader.
// It never allocates GPU memory or starts a model. Whole-file hashing is
// intentional: metadata alone is not checkpoint identity.
func OpenFusionNF4(path string) (*File, error) { return OpenVerified(path, fusionNF4) }

// OpenVerified is the shared single-file admission path for both Flux and
// SDXL. Each model supplies its own immutable Spec; unsupported dtypes or
// malformed tensor bounds are refused. No CUDA or Observatory package is used.
func OpenVerified(path string, pin Spec) (*File, error) {
	if pin.FileBytes <= 0 || pin.TensorCount <= 0 || pin.NF4Weights < 0 || len(pin.ContentSHA256) != 64 || len(pin.DescriptorSHA256) != 64 {
		return nil, fmt.Errorf("incomplete checkpoint verification spec")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open checkpoint: %w", err)
	}
	accepted := false
	defer func() {
		if !accepted {
			_ = f.Close()
		}
	}()
	before, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("stat checkpoint: %w", err)
	}
	if !before.Mode().IsRegular() {
		return nil, fmt.Errorf("checkpoint is not a regular file")
	}
	if before.Size() != pin.FileBytes {
		return nil, fmt.Errorf("checkpoint bytes %d, expected %d", before.Size(), pin.FileBytes)
	}
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return nil, fmt.Errorf("hash checkpoint: %w", err)
	}
	after, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("restat checkpoint: %w", err)
	}
	if before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		return nil, fmt.Errorf("checkpoint changed during integrity read")
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != pin.ContentSHA256 {
		return nil, fmt.Errorf("checkpoint content digest mismatch: %s", got)
	}
	r, err := openSafetensors(f, before.Size())
	if err != nil {
		return nil, err
	}
	if err := validatePinned(r, pin); err != nil {
		return nil, err
	}
	accepted = true
	return r, nil
}

func validatePinned(r *File, pin Spec) error {
	if len(r.names) != pin.TensorCount {
		return fmt.Errorf("checkpoint tensor count %d, expected %d", len(r.names), pin.TensorCount)
	}
	h := sha256.New()
	counts := make(map[string]int, len(pin.PrefixCounts))
	for _, name := range r.names {
		t := r.tensors[name]
		_, _ = io.WriteString(h, name+"\t"+t.DType+"\t")
		for i, d := range t.Shape {
			if i != 0 {
				_, _ = io.WriteString(h, ",")
			}
			_, _ = io.WriteString(h, strconv.FormatInt(d, 10))
		}
		_, _ = io.WriteString(h, "\n")
		for prefix := range pin.PrefixCounts {
			if strings.HasPrefix(name, prefix) {
				counts[prefix]++
			}
		}
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != pin.DescriptorSHA256 {
		return fmt.Errorf("checkpoint descriptor digest mismatch: %s", got)
	}
	for prefix, want := range pin.PrefixCounts {
		if counts[prefix] != want {
			return fmt.Errorf("checkpoint prefix %q has %d tensors, expected %d", prefix, counts[prefix], want)
		}
	}
	return validateNF4(r, pin.NF4Weights)
}

type nf4State struct {
	QuantType       string  `json:"quant_type"`
	BlockSize       int64   `json:"blocksize"`
	DType           string  `json:"dtype"`
	Shape           []int64 `json:"shape"`
	NestedBlockSize int64   `json:"nested_blocksize"`
}

func validateNF4(r *File, want int) error {
	const suffix = ".quant_state.bitsandbytes__nf4"
	count := 0
	for _, name := range r.names {
		if !strings.HasSuffix(name, suffix) {
			continue
		}
		count++
		base := strings.TrimSuffix(name, suffix)
		stateTensor := r.tensors[name]
		if stateTensor.DType != "U8" || stateTensor.End-stateTensor.Start > 4096 {
			return fmt.Errorf("NF4 state %q has invalid storage", name)
		}
		buf := make([]byte, stateTensor.End-stateTensor.Start)
		if err := r.ReadTensorAt(name, 0, buf); err != nil {
			return err
		}
		var state nf4State
		if err := json.Unmarshal(buf, &state); err != nil {
			return fmt.Errorf("NF4 state %q: %w", name, err)
		}
		if state.QuantType != "nf4" || state.BlockSize != 64 || state.DType != "bfloat16" || len(state.Shape) == 0 || state.NestedBlockSize != 0 {
			return fmt.Errorf("NF4 state %q has unsupported settings", name)
		}
		elements := int64(1)
		for _, d := range state.Shape {
			if d <= 0 || elements > int64(^uint64(0)>>1)/d {
				return fmt.Errorf("NF4 state %q original shape overflows", name)
			}
			elements *= d
		}
		packed, ok := r.tensors[base]
		if !ok || packed.DType != "U8" || len(packed.Shape) != 2 || packed.Shape[0] != (elements+1)/2 || packed.Shape[1] != 1 {
			return fmt.Errorf("NF4 packed weight %q is missing or malformed", base)
		}
		if err := requireShape(r, base+".quant_map", "F32", 16); err != nil {
			return err
		}
		if err := requireShape(r, base+".absmax", "F32", (elements+63)/64); err != nil {
			return err
		}
		if _, ok := r.tensors[base+".nested_absmax"]; ok {
			return fmt.Errorf("NF4 weight %q has unsupported nested scale", base)
		}
	}
	if count != want {
		return fmt.Errorf("checkpoint NF4 state count %d, expected %d", count, want)
	}
	return nil
}

func requireShape(r *File, name, dtype string, length int64) error {
	t, ok := r.tensors[name]
	if !ok || t.DType != dtype || len(t.Shape) != 1 || t.Shape[0] != length {
		return fmt.Errorf("NF4 companion %q is missing or malformed", name)
	}
	return nil
}
