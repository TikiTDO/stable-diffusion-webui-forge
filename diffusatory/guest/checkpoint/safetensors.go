// Package checkpoint reads Diffusatory model files without starting an engine.
// It uses only the Go standard library and has no Observatory dependency.
package checkpoint

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
)

const maxHeaderBytes = 100 << 20

// Tensor describes one contiguous tensor in a safetensors file. Offsets are
// relative to the data section, never to the start of the file.
type Tensor struct {
	DType string
	Shape []int64
	Start uint64
	End   uint64
}

// File holds an open descriptor so later bounded ReadAt calls do not reopen a
// path that could name a different artifact. It does not retain tensor bytes.
type File struct {
	f         *os.File
	dataStart int64
	tensors   map[string]Tensor
	names     []string
}

func openSafetensors(f *os.File, fileBytes int64) (*File, error) {
	var prefix [8]byte
	if _, err := f.ReadAt(prefix[:], 0); err != nil {
		return nil, fmt.Errorf("read safetensors header length: %w", err)
	}
	headerBytes := binary.LittleEndian.Uint64(prefix[:])
	if headerBytes == 0 || headerBytes > maxHeaderBytes || headerBytes > uint64(fileBytes-8) {
		return nil, fmt.Errorf("invalid safetensors header length %d", headerBytes)
	}
	dataStart := int64(8 + headerBytes)
	dataBytes := uint64(fileBytes - dataStart)
	header := make([]byte, headerBytes)
	if _, err := f.ReadAt(header, 8); err != nil {
		return nil, fmt.Errorf("read safetensors header: %w", err)
	}
	var entries map[string]json.RawMessage
	if err := json.Unmarshal(header, &entries); err != nil {
		return nil, fmt.Errorf("decode safetensors header: %w", err)
	}
	tensors := make(map[string]Tensor, len(entries))
	names := make([]string, 0, len(entries))
	for name, raw := range entries {
		if name == "__metadata__" {
			continue
		}
		var entry struct {
			DType       string   `json:"dtype"`
			Shape       []int64  `json:"shape"`
			DataOffsets []uint64 `json:"data_offsets"`
		}
		if err := json.Unmarshal(raw, &entry); err != nil {
			return nil, fmt.Errorf("tensor %q descriptor: %w", name, err)
		}
		if len(entry.DataOffsets) != 2 {
			return nil, fmt.Errorf("tensor %q needs two data offsets", name)
		}
		start, end := entry.DataOffsets[0], entry.DataOffsets[1]
		if end < start || end > dataBytes {
			return nil, fmt.Errorf("tensor %q data offsets outside file", name)
		}
		elementBytes, ok := map[string]uint64{
			"F32": 4, "BF16": 2, "F16": 2, "F8_E4M3": 1, "U8": 1,
		}[entry.DType]
		if !ok {
			return nil, fmt.Errorf("tensor %q: unsupported dtype %q", name, entry.DType)
		}
		want := elementBytes
		for _, dim := range entry.Shape {
			if dim < 0 || (dim > 0 && want > ^uint64(0)/uint64(dim)) {
				return nil, fmt.Errorf("tensor %q has invalid shape", name)
			}
			want *= uint64(dim)
		}
		if end-start != want {
			return nil, fmt.Errorf("tensor %q: %d data bytes, shape needs %d", name, end-start, want)
		}
		tensors[name] = Tensor{DType: entry.DType, Shape: entry.Shape, Start: start, End: end}
		names = append(names, name)
	}
	sort.Strings(names)
	byOffset := append([]string(nil), names...)
	sort.Slice(byOffset, func(i, j int) bool { return tensors[byOffset[i]].Start < tensors[byOffset[j]].Start })
	for i := 1; i < len(byOffset); i++ {
		left, right := tensors[byOffset[i-1]], tensors[byOffset[i]]
		if right.Start < left.End {
			return nil, fmt.Errorf("tensors %q and %q overlap", byOffset[i-1], byOffset[i])
		}
	}
	return &File{f: f, dataStart: dataStart, tensors: tensors, names: names}, nil
}

// Names returns all known tensor names in stable order.
func (f *File) Names() []string { return append([]string(nil), f.names...) }

// Info returns an immutable copy of one tensor's descriptor.
func (f *File) Info(name string) (Tensor, error) {
	t, ok := f.tensors[name]
	if !ok {
		return Tensor{}, fmt.Errorf("tensor %q not found", name)
	}
	t.Shape = append([]int64(nil), t.Shape...)
	return t, nil
}

// ReadTensorAt reads a caller-sized byte window inside one tensor. It refuses
// overflow and out-of-bounds windows rather than expanding a whole model layer.
func (f *File) ReadTensorAt(name string, tensorOffset uint64, dst []byte) error {
	t, ok := f.tensors[name]
	if !ok {
		return fmt.Errorf("tensor %q not found", name)
	}
	if tensorOffset > t.End-t.Start || uint64(len(dst)) > t.End-t.Start-tensorOffset {
		return fmt.Errorf("tensor %q read outside its byte range", name)
	}
	_, err := f.f.ReadAt(dst, f.dataStart+int64(t.Start+tensorOffset))
	if err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("tensor %q read: %w", name, err)
	}
	if err != nil {
		return fmt.Errorf("tensor %q short read: %w", name, err)
	}
	return nil
}

// Close releases the file descriptor. No model or GPU state is held here.
func (f *File) Close() error { return f.f.Close() }
