package checkpoint

import (
	"fmt"
	"math"
)

// F8E4M3FN is the finite-only float8 representation named F8_E4M3 by
// safetensors. It is not E4M3FNUZ: this format has signed zero, bias 7,
// subnormal spacing 2^-9, maximum finite magnitude 448, and two NaN codes.
// The byte is storage; callers must decode it before numeric operations.
func F8E4M3FN(code byte) float32 {
	sign := float32(1)
	if code&0x80 != 0 {
		sign = -1
	}
	exp := int((code >> 3) & 15)
	fraction := int(code & 7)
	if exp == 15 && fraction == 7 {
		return math.Float32frombits(0x7fc00000 | uint32(code&0x80)<<24)
	}
	if exp == 0 {
		if fraction == 0 {
			return float32(math.Copysign(0, float64(sign)))
		}
		return sign * float32(math.Ldexp(float64(fraction), -9))
	}
	return sign * float32(math.Ldexp(float64(8+fraction), exp-10))
}

// DecodeF8E4M3FN converts only the caller-provided window. No allocation or
// implicit checkpoint-wide expansion occurs.
func DecodeF8E4M3FN(dst []float32, src []byte) error {
	if len(dst) != len(src) {
		return fmt.Errorf("float8 destination length %d, source length %d", len(dst), len(src))
	}
	for i := range src {
		dst[i] = F8E4M3FN(src[i])
	}
	return nil
}
