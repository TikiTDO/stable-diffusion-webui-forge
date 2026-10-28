package api

import (
	"errors"
	"strings"
	"testing"
)

// reference is the request behind one of Sol's archived Forge plates (seed 19), with its
// full prompt: stage 1 must accept it unchanged.
const reference = `{
  "prompt": "A tall steward in a long dark coat walks a lamplit corridor at night, carrying a small brass lantern. On both sides, open doorways spill warm light: in each room a different maker is at work, a painter at an easel, a figure soldering a glowing circuit, a scribe at a desk of papers, a figure tuning a brass telescope. The steward pauses mid-stride, glancing into one doorway with quiet attention. Painterly, warm amber and deep blue, cinematic wide shot, soft volumetric light, signed \"Sol\" small in the lower right corner.",
  "checkpoint": "fluxFusionV24StepsGGUFNF4_V2NF4AIO_full_nf4",
  "width": 1344, "height": 768, "steps": 8,
  "sampler": "Euler", "scheduler": "Simple", "cfgScale": 1, "seed": 19
}`

func decode(t *testing.T, body string) *GenerateRequest {
	t.Helper()
	req, err := Decode(strings.NewReader(body))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	return req
}

func refusedFields(t *testing.T, err error) []string {
	t.Helper()
	var r *RefusalError
	if !errors.As(err, &r) {
		t.Fatalf("want *RefusalError, got %v", err)
	}
	var fields []string
	for _, f := range r.Fields {
		fields = append(fields, f.Field)
	}
	return fields
}

func TestStage1AcceptsTheArchivedReferenceRequest(t *testing.T) {
	if err := Validate(decode(t, reference), Stage1()); err != nil {
		t.Fatalf("reference request refused: %v", err)
	}
}

func TestStage1RefusesEveryUnsupportedFeatureByName(t *testing.T) {
	body := strings.TrimSuffix(strings.TrimSpace(reference), "}") + `,
  "loras": [{"name": "Locations/harbour", "weight": 0.8}],
  "negativePrompt": "blurry",
  "distilledCfgScale": 3.5,
  "previewEvery": 2,
  "spatialPlan": {"cells": [1]},
  "initImage": "iVBORw0KGgo=", "mask": "iVBORw0KGgo=", "denoisingStrength": 0.5,
  "controlNet": [{"module": "depth"}],
  "modules": ["t5xxl_fp8_e4m3fn"],
  "styles": ["cinematic"],
  "composition": {"version": 1, "prompt": "receipt metadata only"}
}`
	got := refusedFields(t, Validate(decode(t, body), Stage1()))
	want := []string{"negativePrompt", "distilledCfgScale", "previewEvery", "loras", "spatialPlan",
		"initImage", "controlNet", "modules", "styles"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("refused %v, want %v", got, want)
	}
}

func TestEmptyOptionalFieldsAskForNothing(t *testing.T) {
	body := strings.TrimSuffix(strings.TrimSpace(reference), "}") +
		`, "negativePrompt": "", "loras": [], "spatialPlan": null, "controlNet": [], "modules": [], "styles": [],
		"composition": {"version": 1}}`
	if err := Validate(decode(t, body), Stage1()); err != nil {
		t.Fatalf("empty optional fields refused: %v", err)
	}
}

// An explicit zero is still a supplied setting; accepting it would drop it silently.
func TestExplicitZeroSettingsAreRefusedWhenUnsupported(t *testing.T) {
	body := strings.TrimSuffix(strings.TrimSpace(reference), "}") + `, "distilledCfgScale": 0, "previewEvery": 0}`
	got := refusedFields(t, Validate(decode(t, body), Stage1()))
	if strings.Join(got, ",") != "distilledCfgScale,previewEvery" {
		t.Fatalf("refused %v, want [distilledCfgScale previewEvery]", got)
	}
}

func TestMaskNeedsItsOwnCapability(t *testing.T) {
	caps := Stage1()
	caps.Img2Img = true
	body := strings.TrimSuffix(strings.TrimSpace(reference), "}") +
		`, "initImage": "iVBORw0KGgo=", "mask": "iVBORw0KGgo=", "denoisingStrength": 0.5}`
	got := refusedFields(t, Validate(decode(t, body), caps))
	if strings.Join(got, ",") != "mask" {
		t.Fatalf("refused %v, want [mask]", got)
	}
}

// Img2img settings without their image would otherwise be silently ignored.
func TestImageSettingsWithoutTheirImageAreRefused(t *testing.T) {
	body := strings.TrimSuffix(strings.TrimSpace(reference), "}") +
		`, "denoisingStrength": 0.5, "mask": "iVBORw0KGgo=", "inpaintPadding": 32}`
	got := refusedFields(t, Validate(decode(t, body), Stage1()))
	if strings.Join(got, ",") != "initImage,mask" {
		t.Fatalf("refused %v, want [initImage mask]", got)
	}
	body = strings.TrimSuffix(strings.TrimSpace(reference), "}") + `, "maskBlur": 4}`
	got = refusedFields(t, Validate(decode(t, body), Stage1()))
	if strings.Join(got, ",") != "mask" {
		t.Fatalf("refused %v, want [mask]", got)
	}
}

func TestSettingsOutsideTheCheckpointAreRefused(t *testing.T) {
	req := decode(t, reference)
	req.Width, req.Height, req.Steps = 1024, 1024, 20
	req.Sampler, req.Scheduler, req.CFGScale = "DPM++ 2M", "Karras", 7
	req.Seed, req.Outputs, req.Prompt = -1, 4, " "
	got := refusedFields(t, Validate(req, Stage1()))
	want := "prompt,seed,outputs,width,steps,sampler,scheduler,cfgScale"
	if strings.Join(got, ",") != want {
		t.Fatalf("refused %v, want %s", got, want)
	}
}

func TestUnknownCheckpointIsRefused(t *testing.T) {
	req := decode(t, reference)
	req.Checkpoint = "RealVisXL_V5.0_fp16"
	got := refusedFields(t, Validate(req, Stage1()))
	if strings.Join(got, ",") != "checkpoint" {
		t.Fatalf("refused %v, want [checkpoint]", got)
	}
}

func TestDecodeRefusesFieldsTheContractDoesNotName(t *testing.T) {
	body := strings.TrimSuffix(strings.TrimSpace(reference), "}") + `, "hiresFix": true}`
	_, err := Decode(strings.NewReader(body))
	if err == nil || !strings.Contains(err.Error(), "hiresFix") {
		t.Fatalf("want an error naming hiresFix, got %v", err)
	}
}

func TestDecodeRefusesTrailingData(t *testing.T) {
	if _, err := Decode(strings.NewReader(reference + `{}`)); err == nil {
		t.Fatal("trailing object accepted")
	}
}
