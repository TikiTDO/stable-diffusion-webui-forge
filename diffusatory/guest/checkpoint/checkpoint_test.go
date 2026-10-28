package checkpoint

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

type fixtureTensor struct {
	dtype string
	shape []int64
	data  []byte
}

func fixture(t *testing.T, tensors map[string]fixtureTensor) (string, Spec) {
	t.Helper()
	names := make([]string, 0, len(tensors))
	for name := range tensors {
		names = append(names, name)
	}
	sort.Strings(names)
	header := map[string]any{}
	var payload bytes.Buffer
	var descriptors strings.Builder
	for _, name := range names {
		v := tensors[name]
		start := payload.Len()
		payload.Write(v.data)
		header[name] = map[string]any{
			"dtype": v.dtype, "shape": v.shape,
			"data_offsets": []int{start, payload.Len()},
		}
		fmt.Fprintf(&descriptors, "%s\t%s\t", name, v.dtype)
		for i, d := range v.shape {
			if i > 0 {
				descriptors.WriteByte(',')
			}
			fmt.Fprintf(&descriptors, "%d", d)
		}
		descriptors.WriteByte('\n')
	}
	h, err := json.Marshal(header)
	if err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	if err := binary.Write(&archive, binary.LittleEndian, uint64(len(h))); err != nil {
		t.Fatal(err)
	}
	archive.Write(h)
	archive.Write(payload.Bytes())
	path := filepath.Join(t.TempDir(), "fixture.safetensors")
	if err := os.WriteFile(path, archive.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	return path, Spec{
		FileBytes:        int64(archive.Len()),
		ContentSHA256:    fmt.Sprintf("%x", sha256.Sum256(archive.Bytes())),
		DescriptorSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(descriptors.String()))),
		TensorCount:      len(tensors),
	}
}

func TestFP8E4M3FNAllCodes(t *testing.T) {
	// Independent bit oracle for the 256 possible storage bytes. Normal values
	// map to FP32's exponent/fraction bits; subnormals are integer / 512.
	for code := 0; code < 256; code++ {
		got := F8E4M3FN(byte(code))
		exp, fraction := (code>>3)&15, code&7
		if exp == 15 && fraction == 7 {
			if !math.IsNaN(float64(got)) {
				t.Fatalf("%02x: expected NaN, got %g", code, got)
			}
			continue
		}
		var want uint32
		if exp == 0 {
			want = math.Float32bits(float32(fraction) / 512)
		} else {
			want = uint32(exp+120)<<23 | uint32(fraction)<<20
		}
		want |= uint32(code&0x80) << 24
		if math.Float32bits(got) != want {
			t.Fatalf("%02x: got %08x, want %08x", code, math.Float32bits(got), want)
		}
	}
	for code, want := range map[byte]float32{0x01: 1.0 / 512, 0x08: 1.0 / 64, 0x38: 1, 0x7e: 448, 0xfe: -448} {
		if got := F8E4M3FN(code); got != want {
			t.Errorf("%02x: got %g, want %g", code, got, want)
		}
	}
	dst := make([]float32, 2)
	if err := DecodeF8E4M3FN(dst, []byte{0x38}); err == nil {
		t.Fatal("mismatched decode lengths accepted")
	}
	if err := DecodeF8E4M3FN(dst, []byte{0x38, 0x7e}); err != nil || dst[0] != 1 || dst[1] != 448 {
		t.Fatalf("bounded decode: %v, %v", err, dst)
	}
}

func TestPinnedCheckpointRejectsContentAndShapeMutation(t *testing.T) {
	path, pin := fixture(t, map[string]fixtureTensor{"t5.weight": {"F8_E4M3", []int64{2}, []byte{0x38, 0x7e}}})
	r, err := OpenVerified(path, pin)
	if err != nil {
		t.Fatal(err)
	}
	info, err := r.Info("t5.weight")
	if err != nil || info.DType != "F8_E4M3" || len(info.Shape) != 1 || info.Shape[0] != 2 {
		t.Fatalf("info: %+v, %v", info, err)
	}
	var one [1]byte
	if err := r.ReadTensorAt("t5.weight", 1, one[:]); err != nil || one[0] != 0x7e {
		t.Fatalf("bounded read: %02x, %v", one[0], err)
	}
	if err := r.ReadTensorAt("t5.weight", 2, one[:]); err == nil {
		t.Fatal("out-of-bounds tensor read accepted")
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}

	changed, _ := fixture(t, map[string]fixtureTensor{"t5.weight": {"F8_E4M3", []int64{2}, []byte{0x38, 0x7d}}})
	if _, err := OpenVerified(changed, pin); err == nil || !strings.Contains(err.Error(), "content digest mismatch") {
		t.Fatalf("changed payload accepted: %v", err)
	}
	reshaped, reshapePin := fixture(t, map[string]fixtureTensor{"t5.weight": {"F8_E4M3", []int64{1, 2}, []byte{0x38, 0x7e}}})
	pin.ContentSHA256 = reshapePin.ContentSHA256
	pin.FileBytes = reshapePin.FileBytes
	if _, err := OpenVerified(reshaped, pin); err == nil || !strings.Contains(err.Error(), "descriptor digest mismatch") {
		t.Fatalf("changed shape accepted: %v", err)
	}
}

func TestNF4PartnersAreRequired(t *testing.T) {
	state, err := json.Marshal(nf4State{QuantType: "nf4", BlockSize: 64, DType: "bfloat16", Shape: []int64{8, 8}})
	if err != nil {
		t.Fatal(err)
	}
	const base = "model.diffusion_model.img_in.weight"
	tensors := map[string]fixtureTensor{
		base:                                    {"U8", []int64{32, 1}, make([]byte, 32)},
		base + ".quant_state.bitsandbytes__nf4": {"U8", []int64{int64(len(state))}, state},
		base + ".quant_map":                     {"F32", []int64{16}, make([]byte, 64)},
		base + ".absmax":                        {"F32", []int64{1}, make([]byte, 4)},
	}
	path, _ := fixture(t, tensors)
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	r, err := openSafetensors(f, fileSize(t, f))
	if err != nil {
		t.Fatal(err)
	}
	if err := validateNF4(r, 1); err != nil {
		t.Fatal(err)
	}
	_ = r.Close()

	delete(tensors, base+".absmax")
	missing, _ := fixture(t, tensors)
	f, err = os.Open(missing)
	if err != nil {
		t.Fatal(err)
	}
	r, err = openSafetensors(f, fileSize(t, f))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if err := validateNF4(r, 1); err == nil || !strings.Contains(err.Error(), "companion") {
		t.Fatalf("missing NF4 partner accepted: %v", err)
	}
}

func fileSize(t *testing.T, f *os.File) int64 {
	t.Helper()
	st, err := f.Stat()
	if err != nil {
		t.Fatal(err)
	}
	return st.Size()
}

// Set this only on the model host. This reads the existing 12.34 GB file and
// its small quantization state payloads, not model parameters into RAM or GPU.
func TestCanonicalFusionNF4File(t *testing.T) {
	path := os.Getenv("FLUX_FUSION_CHECKPOINT")
	if path == "" {
		t.Skip("FLUX_FUSION_CHECKPOINT is not set")
	}
	r, err := OpenFusionNF4(path)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if got := len(r.Names()); got != fusionNF4.TensorCount {
		t.Fatalf("tensor count %d", got)
	}
}
