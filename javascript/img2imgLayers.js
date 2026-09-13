const img2imgLayerNames = ["Paint", "Mask"];
const img2imgBrushMaximum = 32;

function img2imgEyedropperIcon() {
    return `<div style="display:flex;width:1.5rem;height:1.5rem"><svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m19.4 3.6 1 1a2 2 0 0 1 0 2.8l-3.1 3.1 1.2 1.2-1.8 1.8-6.2-6.2 1.8-1.8 1.2 1.2 3.1-3.1a2 2 0 0 1 2.8 0Z" fill="currentColor"/>
        <path d="m12.7 9.3-8.4 8.4-.8 2.8 2.8-.8 8.4-8.4" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    </svg></div>`;
}

function limitImg2ImgBrushRange(editor) {
    const brushRange = editor.querySelector('input[type="range"]');
    if (brushRange && brushRange.max != String(img2imgBrushMaximum)) {
        brushRange.max = String(img2imgBrushMaximum);
        brushRange.setAttribute("aria-label", `Brush size, 1 to ${img2imgBrushMaximum} pixels`);
        const progress = Math.max(0, Math.min(100,
            ((Number(brushRange.value) - Number(brushRange.min)) / (img2imgBrushMaximum - Number(brushRange.min))) * 100));
        brushRange.style.setProperty("--range_progress", `${progress}%`);
    }
}

function equipImg2ImgBrush(editor) {
    limitImg2ImgBrushRange(editor);
    if (!editor.dataset.diffusatoryBrushObserver) {
        new MutationObserver(() => limitImg2ImgBrushRange(editor)).observe(editor, {
            childList: true,
            subtree: true,
        });
        editor.dataset.diffusatoryBrushObserver = "true";
    }

    const sizeButton = editor.querySelector('button[aria-label="Brush Size"]');
    if (!sizeButton || editor.querySelector('button[data-diffusatory-eyedropper]')) return;

    const colorButton = editor.querySelector('button[aria-label="Color"]');
    if (!colorButton) return;
    const eyedropper = document.createElement("button");
    eyedropper.type = "button";
    eyedropper.className = colorButton.className;
    eyedropper.dataset.diffusatoryEyedropper = "true";
    eyedropper.setAttribute("aria-label", "Pick colour from image");
    eyedropper.title = "Pick colour from image";
    eyedropper.innerHTML = img2imgEyedropperIcon();
    eyedropper.addEventListener("click", async () => {
        if (!window.EyeDropper) {
            colorButton.click();
            eyedropper.title = "Eyedropper unavailable in this browser; choose a colour from the palette";
            return;
        }
        try {
            const {sRGBHex} = await new window.EyeDropper().open();
            let input = editor.querySelector(".color_picker input");
            if (!input) {
                // Gradio renders the arbitrary-colour control only after its
                // palette is open, then renders the hex input after that
                // control is selected.
                colorButton.click();
                await new Promise((resolve) => setTimeout(resolve, 25));
                editor.querySelector("button.colorpicker")?.click();
                for (let attempt = 0; attempt < 10 && !input; attempt++) {
                    await new Promise((resolve) => setTimeout(resolve, 25));
                    input = editor.querySelector(".color_picker input");
                }
            }
            if (!input) throw new Error("brush colour input did not open");
            const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
            setValue.call(input, sRGBHex);
            input.dispatchEvent(new Event("input", {bubbles: true}));
            input.dispatchEvent(new Event("change", {bubbles: true}));
        } catch (error) {
            if (error?.name != "AbortError") console.warn("Could not pick a brush colour", error);
        }
    });
    sizeButton.before(eyedropper);
}

function labelImg2ImgLayers() {
    const editor = gradioApp().getElementById("img2img_editor");
    if (!editor) return;
    equipImg2ImgBrush(editor);

    // A server-returning action rebuilds the layers with Gradio's generic
    // names. When the panel is closed, its layer buttons are not mounted, so
    // restore the selected label directly from the generic title as well.
    const toggle = editor.querySelector('button[aria-label="Show Layers"]');
    const genericTitle = toggle?.textContent.trim().match(/^Layer (\d+)$/);
    const genericIndex = genericTitle ? Number(genericTitle[1]) - 1 : -1;
    if (toggle && img2imgLayerNames[genericIndex]) {
        toggle.textContent = img2imgLayerNames[genericIndex];
    }

    const layerButtons = Array.from(editor.querySelectorAll('button[aria-label^="layer-"], button[data-diffusatory-layer-index]'))
        .filter((button) => button.dataset.diffusatoryLayerIndex || /^layer-\d+$/.test(button.getAttribute("aria-label") || ""))
        .sort((left, right) => {
            const leftIndex = Number(left.dataset.diffusatoryLayerIndex || left.getAttribute("aria-label").slice(6));
            const rightIndex = Number(right.dataset.diffusatoryLayerIndex || right.getAttribute("aria-label").slice(6));
            return leftIndex - rightIndex;
        });

    layerButtons.slice(0, img2imgLayerNames.length).forEach((button, index) => {
        const name = img2imgLayerNames[index];
        const layerIndex = String(index + 1);
        const title = index == 0
            ? "Colour painted onto the source image"
            : "Selection used by the Inpaint workflow";

        if (button.dataset.diffusatoryLayerIndex != layerIndex) {
            button.dataset.diffusatoryLayerIndex = layerIndex;
        }
        if (button.textContent.trim() != name) button.textContent = name;
        if (button.getAttribute("aria-label") != `${name} layer`) {
            button.setAttribute("aria-label", `${name} layer`);
        }
        if (button.title != title) button.title = title;
    });

    const layerWrap = layerButtons[0]?.closest(".layer-wrap");
    const selectedIndex = layerButtons.findIndex((button) => button.classList.contains("selected_layer"));
    if (layerWrap?.classList.contains("closed") && toggle && selectedIndex >= 0) {
        const name = img2imgLayerNames[selectedIndex];
        if (toggle.textContent.trim() != name) toggle.textContent = name;
    }
}

// Gradio restores returned image layers with generic names. The layer order is
// stable, so restore the product names after both initial mount and callbacks.
onUiLoaded(labelImg2ImgLayers);
onAfterUiUpdate(labelImg2ImgLayers);
