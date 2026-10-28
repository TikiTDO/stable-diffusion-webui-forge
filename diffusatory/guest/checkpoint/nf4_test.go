package checkpoint

import (
	"math"
	"strings"
	"testing"
)

func TestDecodeNF4BF16NibbleOrderAndBlockBoundary(t *testing.T) {
	var codebook [16]float32
	for code := range codebook {
		codebook[code] = float32(code-8) / 8
	}
	packed := make([]byte, 33)
	for i := range packed {
		packed[i] = byte((2*i%16)<<4 | ((2*i + 1) % 16))
	}
	dst := make([]float32, 65)
	if err := DecodeNF4BF16(dst, packed, []float32{2, 4}, codebook); err != nil {
		t.Fatal(err)
	}
	for i, got := range dst {
		// Every term is exactly representable in BF16, independently testing
		// which nibble and which 64-value block supplied it.
		want := float32(i%16-8) / 8 * 2
		if i == 64 {
			want = -4
		}
		if got != want {
			t.Fatalf("value %d: got %g, want %g", i, got, want)
		}
	}
}

func TestDecodeNF4BF16TiesToEven(t *testing.T) {
	var codebook [16]float32
	codebook[0] = 1.00390625  // halfway from BF16 1.0 to 1.0078125
	codebook[1] = 1.01171875  // halfway from 1.0078125 to 1.015625
	codebook[2] = -1.00390625 // negative midpoint also rounds to even
	var dst [2]float32
	if err := DecodeNF4BF16(dst[:], []byte{0x01}, []float32{1}, codebook); err != nil {
		t.Fatal(err)
	}
	if math.Float32bits(dst[0]) != 0x3f800000 || math.Float32bits(dst[1]) != 0x3f820000 {
		t.Fatalf("ties: got bits %08x, %08x", math.Float32bits(dst[0]), math.Float32bits(dst[1]))
	}
	if err := DecodeNF4BF16(dst[:], []byte{0x20}, []float32{1}, codebook); err != nil {
		t.Fatal(err)
	}
	if math.Float32bits(dst[0]) != 0xbf800000 {
		t.Fatalf("negative tie: got bits %08x", math.Float32bits(dst[0]))
	}
}

func TestDecodeNF4BF16RefusesMalformedWindow(t *testing.T) {
	var codebook [16]float32
	var dst [2]float32
	if err := DecodeNF4BF16(dst[:], nil, []float32{1}, codebook); err == nil || !strings.Contains(err.Error(), "packed bytes") {
		t.Fatalf("missing packed data: %v", err)
	}
	if err := DecodeNF4BF16(dst[:], []byte{0}, nil, codebook); err == nil || !strings.Contains(err.Error(), "scales") {
		t.Fatalf("missing scale: %v", err)
	}
	codebook[1] = float32(math.NaN())
	if err := DecodeNF4BF16(dst[:], []byte{0}, []float32{1}, codebook); err == nil || !strings.Contains(err.Error(), "codebook") {
		t.Fatalf("nonfinite map: %v", err)
	}
	codebook[1] = 0
	if err := DecodeNF4BF16(dst[:], []byte{0}, []float32{-1}, codebook); err == nil || !strings.Contains(err.Error(), "absmax") {
		t.Fatalf("negative scale: %v", err)
	}
	if err := DecodeNF4BF16(dst[:], []byte{0}, []float32{0}, codebook); err != nil {
		t.Fatalf("zero scale should be legal: %v", err)
	}
	codebook[0] = math.MaxFloat32
	if err := DecodeNF4BF16(dst[:], []byte{0}, []float32{2}, codebook); err == nil || !strings.Contains(err.Error(), "overflows") {
		t.Fatalf("overflowing product: %v", err)
	}
}
