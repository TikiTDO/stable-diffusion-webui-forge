package checkpoint

import (
	"fmt"
	"math"
)

// DecodeNF4BF16 decodes one caller-sized, block-aligned window of a
// bitsandbytes NF4 weight. The first value is the high nibble, the second is
// the low nibble. One absmax applies to each 64 original values. The product
// is rounded to the weight's BF16 dtype, then widened to float32 for a scalar
// correctness oracle. Callers must not treat this as a whole-model loader.
//
// An error can leave dst partly written; the caller must discard it.
func DecodeNF4BF16(dst []float32, packed []byte, absmax []float32, codebook [16]float32) error {
	if len(packed) != (len(dst)+1)/2 || len(absmax) != (len(dst)+63)/64 {
		return fmt.Errorf("NF4 window: %d values need %d packed bytes and %d scales, got %d and %d",
			len(dst), (len(dst)+1)/2, (len(dst)+63)/64, len(packed), len(absmax))
	}
	for i, v := range codebook {
		if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
			return fmt.Errorf("NF4 codebook[%d] is not finite", i)
		}
	}
	for i, v := range absmax {
		if v < 0 || math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
			return fmt.Errorf("NF4 absmax[%d] is not finite and nonnegative", i)
		}
	}
	for i := range dst {
		b := packed[i/2]
		code := b >> 4
		if i&1 != 0 {
			code = b & 15
		}
		value := codebook[code] * absmax[i/64]
		if math.IsInf(float64(value), 0) {
			return fmt.Errorf("NF4 value %d overflows float32", i)
		}
		bits := math.Float32bits(value)
		bits += 0x7fff + (bits>>16)&1 // BF16 round-to-nearest, ties-to-even.
		value = math.Float32frombits(bits &^ 0xffff)
		if math.IsInf(float64(value), 0) {
			return fmt.Errorf("NF4 value %d overflows bfloat16", i)
		}
		dst[i] = value
	}
	return nil
}
