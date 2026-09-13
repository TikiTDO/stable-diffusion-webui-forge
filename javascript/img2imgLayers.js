const img2imgLayerNames = ["Paint", "Mask"];

function labelImg2ImgLayers() {
    const editor = gradioApp().getElementById("img2img_editor");
    if (!editor) return;

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
    const toggle = editor.querySelector('button[aria-label="Show Layers"]');
    if (layerWrap?.classList.contains("closed") && toggle && selectedIndex >= 0) {
        const name = img2imgLayerNames[selectedIndex];
        if (toggle.textContent.trim() != name) toggle.textContent = name;
    }
}

// Gradio restores returned image layers with generic names. The layer order is
// stable, so restore the product names after both initial mount and callbacks.
onUiLoaded(labelImg2ImgLayers);
onAfterUiUpdate(labelImg2ImgLayers);
