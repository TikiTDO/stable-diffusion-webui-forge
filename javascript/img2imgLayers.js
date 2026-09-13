const img2imgLayerNames = ["Paint", "Mask"];
const img2imgBrushMaximum = 32;

function diffusatoryImg2ImgEditor() {
    const editor = window.editor;
    const root = gradioApp().getElementById("img2img_editor");
    if (!editor?.layer_manager || !editor?.app?.renderer || !root?.contains(editor.target_element)) {
        console.warn("The Diffusatory image editor is not ready");
        return null;
    }
    return editor;
}

function renderImg2ImgLayer(sourceIndex, targetIndex) {
    const editor = diffusatoryImg2ImgEditor();
    const layers = editor?.layer_manager.get_layers();
    const target = layers?.[targetIndex];
    const targetTexture = target && editor.layer_manager.get_layer_textures(target.id)?.draw;
    if (!targetTexture) return [];

    // Rendering an empty Pixi container is the reliable way to clear the
    // layer's render texture. renderer.clear() does not invalidate the
    // texture snapshot returned by Gradio's ImageEditor.
    const Container = target.container.constructor;
    const renderContainer = new Container();
    if (sourceIndex !== null) {
        const source = layers[sourceIndex];
        const sourceTexture = source && editor.layer_manager.get_layer_textures(source.id)?.draw;
        const sourceSprite = source?.container.children[0];
        if (!sourceTexture || !sourceSprite) {
            renderContainer.destroy();
            return [];
        }
        const Sprite = sourceSprite.constructor;
        renderContainer.addChild(new Sprite(sourceTexture));
    }

    editor.app.renderer.render({container: renderContainer, target: targetTexture, clear: true});
    renderContainer.destroy({children: true});
    editor.wake_render_loop();
    return [];
}

function clearImg2ImgPaint() {
    return renderImg2ImgLayer(null, 0);
}

function clearImg2ImgMask() {
    return renderImg2ImgLayer(null, 1);
}

function maskImg2ImgFromPaint() {
    return renderImg2ImgLayer(0, 1);
}

function setImg2ImgNumber(id, value) {
    const input = gradioApp().querySelector(`#${id} input[type="number"]`);
    if (!input) return;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setValue.call(input, String(value));
    input.dispatchEvent(new Event("input", {bubbles: true}));
    input.dispatchEvent(new Event("change", {bubbles: true}));
}

function detectImg2ImgSize() {
    const editor = diffusatoryImg2ImgEditor();
    if (!editor?.width || !editor?.height) return [];
    setImg2ImgNumber("img2img_width", editor.width);
    setImg2ImgNumber("img2img_height", editor.height);
    updateImg2ImgScaleResolutionPreview();
    return [];
}

function selectImg2ImgResizeMode(mode) {
    setTimeout(updateImg2ImgScaleResolutionPreview, 0);
    return [mode];
}

function autoSizeImg2Img(editorRoot) {
    const editor = diffusatoryImg2ImgEditor();
    if (!opts.img2img_autosize || !editor?.width || !editor?.height) return;
    const size = `${editor.width}x${editor.height}`;
    if (editorRoot.dataset.diffusatoryAutoSize === size) return;
    editorRoot.dataset.diffusatoryAutoSize = size;
    setImg2ImgNumber("img2img_width", editor.width);
    setImg2ImgNumber("img2img_height", editor.height);
}

function updateImg2ImgScaleResolutionPreview(scale) {
    const editor = diffusatoryImg2ImgEditor();
    const output = gradioApp().getElementById("img2img_scale_resolution_preview");
    if (!output) return [];

    const scaleInput = gradioApp().querySelector('#img2img_scale input[type="number"]');
    const factor = Number(scale ?? scaleInput?.value ?? 0);
    let html = "no image selected";
    if (editor?.width && editor?.height && factor > 0) {
        const targetWidth = Math.floor(editor.width * factor / 8) * 8;
        const targetHeight = Math.floor(editor.height * factor / 8) * 8;
        html = `resize: from <span class="resolution">${editor.width}x${editor.height}</span> ` +
            `to <span class="resolution">${targetWidth}x${targetHeight}</span>`;
    }
    const content = output.querySelector(".prose") || output;
    if (content.innerHTML !== html) content.innerHTML = html;
    return [];
}

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
    eyedropper.addEventListener("click", async() => {
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
    autoSizeImg2Img(editor);
    updateImg2ImgScaleResolutionPreview();

    // Restored editor values can arrive with Gradio's generic layer names.
    // When the panel is closed, its layer buttons are not mounted, so restore
    // the selected label directly from the generic title as well.
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
        const title = index == 0 ?
            "Colour painted onto the source image" :
            "Selection used by the Inpaint workflow";

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

// Gradio may restore image layers with generic names. The layer order is
// stable, so restore the product names after both initial mount and callbacks.
onUiLoaded(labelImg2ImgLayers);
onAfterUiUpdate(labelImg2ImgLayers);
