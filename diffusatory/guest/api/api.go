// Package api holds the typed generation contract the Diffusatory guest serves.
//
// The React client speaks this contract instead of Forge's sdapi. Each engine stage
// declares what it supports in Capabilities, and Validate refuses every field outside
// that set by name. A field the client sends is never accepted and silently dropped:
// a plate that ignored its LoRA or its spatial plan would look like a valid render of
// a different request, and nobody could tell from the picture.
package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
)

// ContractVersion is bumped when a field changes meaning; adding a field the decoder
// refuses until a stage supports it does not need a bump.
const ContractVersion = 1

// GenerateRequest is one text-to-image or image-to-image request. Every JSON name is the
// client's own field name from Txt2ImgInput and Img2ImgInput in
// web/src/api/forge/types.ts, at the same level, so the client sends its input object
// as it already holds it. Two client shapes differ: prompt and negativePrompt are a
// single string here (the client expands prompt lists into separate requests), and
// composition is carried as opaque receipt metadata, as Forge stored it.
type GenerateRequest struct {
	Prompt            string   `json:"prompt"`
	NegativePrompt    string   `json:"negativePrompt,omitempty"`
	Checkpoint        string   `json:"checkpoint"`
	Width             int      `json:"width"`
	Height            int      `json:"height"`
	Steps             int      `json:"steps"`
	Sampler           string   `json:"sampler"`
	Scheduler         string   `json:"scheduler"`
	CFGScale          float64  `json:"cfgScale"`
	DistilledCFGScale *float64 `json:"distilledCfgScale,omitempty"`
	// Seed is required: a receipt without the seed cannot be reproduced. A pointer keeps
	// an omitted seed apart from an explicit 0. -1 is refused rather than randomised
	// here; the client picks and records a seed.
	Seed    *int64 `json:"seed"`
	Outputs int    `json:"outputs,omitempty"`

	PreviewEvery *int            `json:"previewEvery,omitempty"`
	LoRAs        []LoRA          `json:"loras,omitempty"`
	SpatialPlan  json.RawMessage `json:"spatialPlan,omitempty"`
	ControlNet   json.RawMessage `json:"controlNet,omitempty"`
	Modules      []string        `json:"modules,omitempty"`
	Styles       []string        `json:"styles,omitempty"`
	Composition  json.RawMessage `json:"composition,omitempty"`

	// Img2ImgInput fields, top-level as the client sends them. InitImage and Mask are
	// base64 PNG; white in Mask selects the region to regenerate.
	InitImage         string   `json:"initImage,omitempty"`
	Mask              string   `json:"mask,omitempty"`
	DenoisingStrength *float64 `json:"denoisingStrength,omitempty"`
	MaskBlur          *int     `json:"maskBlur,omitempty"`
	InpaintOnlyMasked *bool    `json:"inpaintOnlyMasked,omitempty"`
	InpaintPadding    *int     `json:"inpaintPadding,omitempty"`
	ResizeMode        *int     `json:"resizeMode,omitempty"`
}

// LoRA is one adapter and its weight, by catalog name.
type LoRA struct {
	Name   string  `json:"name"`
	Weight float64 `json:"weight"`
}

// Capabilities is what one engine stage can honour. The guest publishes it at
// /api/v2/capabilities so the client can disable controls instead of discovering
// refusals one request at a time. Every switch defaults to off: a feature is advertised
// only after the engine has measured it, never because its weights are readable.
type Capabilities struct {
	ContractVersion   int          `json:"contractVersion"`
	Checkpoints       []Checkpoint `json:"checkpoints"`
	NegativePrompt    bool         `json:"negativePrompt"`
	DistilledCFGScale bool         `json:"distilledCfgScale"`
	Preview           bool         `json:"preview"`
	LoRA              bool         `json:"lora"`
	SpatialPlan       bool         `json:"spatialPlan"`
	Img2Img           bool         `json:"img2img"`
	Mask              bool         `json:"mask"`
	ControlNet        bool         `json:"controlNet"`
	MaxOutputs        int          `json:"maxOutputs"`
}

// Checkpoint is one loadable model and the exact settings measured on it. Sizes and
// steps are lists, not ranges: a size the engine has not rendered is not admitted.
type Checkpoint struct {
	Name       string     `json:"name"`
	Family     string     `json:"family"` // "flux" or "sdxl"
	Sizes      []Size     `json:"sizes"`
	Steps      []int      `json:"steps"`
	Samplers   []string   `json:"samplers"`
	Schedulers []string   `json:"schedulers"`
	CFG        [2]float64 `json:"cfgRange"`
}

// Size is one admitted output size in pixels.
type Size struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// Stage1 is the target of the first engine slice: Flux text-to-image on the NF4
// all-in-one checkpoint at exactly the archived Forge reference recipe (Sol's intro
// plates: 1344x768, 8 steps, cfg 1, Euler/Simple), one image per request. The guest publishes
// it only once the engine has rendered that recipe; wider sizes and steps are added as
// each one is measured.
func Stage1() Capabilities {
	return Capabilities{
		ContractVersion: ContractVersion,
		Checkpoints: []Checkpoint{{
			Name:       "fluxFusionV24StepsGGUFNF4_V2NF4AIO_full_nf4",
			Family:     "flux",
			Sizes:      []Size{{Width: 1344, Height: 768}},
			Steps:      []int{8},
			Samplers:   []string{"Euler"},
			Schedulers: []string{"Simple"},
			CFG:        [2]float64{1, 1},
		}},
		MaxOutputs: 1,
	}
}

// FieldError names the request field a stage refused and why. Field uses the JSON name
// so the client can point at the control that caused it.
type FieldError struct {
	Field  string `json:"field"`
	Reason string `json:"reason"`
}

// RefusalError is every field refusal in one request, so the user fixes them together.
type RefusalError struct {
	Fields []FieldError `json:"fields"`
}

func (e *RefusalError) Error() string {
	parts := make([]string, len(e.Fields))
	for i, f := range e.Fields {
		parts[i] = f.Field + ": " + f.Reason
	}
	return "diffusatory: request refused: " + strings.Join(parts, "; ")
}

// Decode reads one request and refuses any JSON field this contract does not name. A
// client newer than the guest gets an error naming the field, not a render without it.
func Decode(r io.Reader) (*GenerateRequest, error) {
	dec := json.NewDecoder(r)
	dec.DisallowUnknownFields()
	var req GenerateRequest
	if err := dec.Decode(&req); err != nil {
		return nil, fmt.Errorf("diffusatory: decode request: %w", err)
	}
	if dec.More() {
		return nil, errors.New("diffusatory: decode request: trailing data after the request object")
	}
	return &req, nil
}

// Validate checks req against what caps can honour and returns a *RefusalError listing
// every field it refuses, or nil. It never edits req: defaults are the client's job, so
// the receipt records exactly what was asked for.
func Validate(req *GenerateRequest, caps Capabilities) error {
	var out []FieldError
	refuse := func(field, format string, args ...any) {
		out = append(out, FieldError{Field: field, Reason: fmt.Sprintf(format, args...)})
	}
	unsupported := func(field string) { refuse(field, "not supported by this engine stage") }

	if strings.TrimSpace(req.Prompt) == "" {
		refuse("prompt", "required")
	}
	if req.Seed == nil || *req.Seed < 0 {
		refuse("seed", "required and non-negative; the client chooses and records the seed")
	}
	if req.Outputs < 0 || req.Outputs > caps.MaxOutputs {
		refuse("outputs", "must be between 1 and %d (0 means 1)", caps.MaxOutputs)
	}

	i := slices.IndexFunc(caps.Checkpoints, func(c Checkpoint) bool { return c.Name == req.Checkpoint })
	if i < 0 {
		refuse("checkpoint", "%q is not loadable by this engine stage", req.Checkpoint)
	} else {
		ck := caps.Checkpoints[i]
		if !slices.Contains(ck.Sizes, Size{Width: req.Width, Height: req.Height}) {
			refuse("width", "%dx%d is not an admitted size for %s; admitted: %v", req.Width, req.Height, ck.Name, ck.Sizes)
		}
		if !slices.Contains(ck.Steps, req.Steps) {
			refuse("steps", "%d is not admitted for %s; admitted: %v", req.Steps, ck.Name, ck.Steps)
		}
		if !slices.Contains(ck.Samplers, req.Sampler) {
			refuse("sampler", "%q is not one of %v", req.Sampler, ck.Samplers)
		}
		if !slices.Contains(ck.Schedulers, req.Scheduler) {
			refuse("scheduler", "%q is not one of %v", req.Scheduler, ck.Schedulers)
		}
		if req.CFGScale < ck.CFG[0] || req.CFGScale > ck.CFG[1] {
			refuse("cfgScale", "must be between %g and %g for %s", ck.CFG[0], ck.CFG[1], ck.Name)
		}
	}

	if req.NegativePrompt != "" && !caps.NegativePrompt {
		unsupported("negativePrompt")
	}
	// Presence, not value: an explicit 0 is still a setting the stage would drop.
	if req.DistilledCFGScale != nil && !caps.DistilledCFGScale {
		unsupported("distilledCfgScale")
	}
	if req.PreviewEvery != nil && !caps.Preview {
		unsupported("previewEvery")
	}
	if len(req.LoRAs) > 0 && !caps.LoRA {
		unsupported("loras")
	}
	if present(req.SpatialPlan) && !caps.SpatialPlan {
		unsupported("spatialPlan")
	}
	if req.InitImage != "" {
		if !caps.Img2Img {
			unsupported("initImage")
		}
	} else if req.DenoisingStrength != nil || req.ResizeMode != nil {
		refuse("initImage", "required when denoisingStrength or resizeMode is sent")
	}
	maskSettings := req.MaskBlur != nil || req.InpaintOnlyMasked != nil || req.InpaintPadding != nil
	if req.Mask != "" {
		if req.InitImage == "" {
			refuse("mask", "needs initImage")
		} else if caps.Img2Img && !caps.Mask {
			unsupported("mask")
		}
	} else if maskSettings {
		refuse("mask", "required when maskBlur, inpaintOnlyMasked or inpaintPadding is sent")
	}
	if present(req.ControlNet) && !caps.ControlNet {
		unsupported("controlNet")
	}
	// Forge modules and styles have no engine meaning here: modules were Forge's way to
	// pick separate encoder/VAE files, and the client expands styles into the prompt.
	if len(req.Modules) > 0 {
		refuse("modules", "the checkpoint carries its own encoders and VAE; send none")
	}
	if len(req.Styles) > 0 {
		refuse("styles", "expand styles into the prompt on the client; send none")
	}

	if len(out) > 0 {
		return &RefusalError{Fields: out}
	}
	return nil
}

// present reports whether an optional raw JSON field carries a value; an explicit null,
// empty object or empty array asks for nothing and is not refused.
func present(raw json.RawMessage) bool {
	t := bytes.TrimSpace(raw)
	return len(t) > 0 && !bytes.Equal(t, []byte("null")) && !bytes.Equal(t, []byte("{}")) && !bytes.Equal(t, []byte("[]"))
}
