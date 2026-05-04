import GUI from "lil-gui";
import config from '../config.json';

export function getControlConfig(key) {
  return config?.ui?.[key] ?? {};
}

export function getControlLabel(key, fallbackLabel) {
  return getControlConfig(key).label ?? fallbackLabel;
}

export function isControlVisible(key, fallbackVisible = true) {
  const controlConfig = getControlConfig(key);
  if (typeof controlConfig.visible === "boolean") {
    return controlConfig.visible;
  }

  if (key === "sourceShape") {
    return Boolean(config?.ui?.showSourceShapeDropdown);
  }

  return fallbackVisible;
}

export function addSliderControl(parentGui, key, fallbackLabel, fallbackMin, fallbackMax, params, onChange) {
  if (!isControlVisible(key)) {
    return null;
  }

  const controlConfig = getControlConfig(key);
  const controller = parentGui.add(params, key, controlConfig.min ?? fallbackMin, controlConfig.max ?? fallbackMax);
  controller.name(getControlLabel(key, fallbackLabel));
  if (onChange) {
    controller.onChange(onChange);
  }
  return controller;
}

export function addDropdownControl(parentGui, key, fallbackLabel, options, params, onChange) {
  if (!isControlVisible(key)) {
    return null;
  }

  const controller = parentGui.add(params, key, options);
  controller.name(getControlLabel(key, fallbackLabel));
  if (onChange) {
    controller.onChange(onChange);
  }
  return controller;
}

export function createGUI() {
  return new GUI();
}

export function createRenderModeDropdown() {
  const renderModeContainer = document.createElement("div");
  renderModeContainer.style.position = "fixed";
  renderModeContainer.style.left = "14px";
  renderModeContainer.style.bottom = "14px";
  renderModeContainer.style.padding = "8px 10px";
  renderModeContainer.style.background = "rgba(16, 16, 16, 0.72)";
  renderModeContainer.style.border = "1px solid rgba(255, 255, 255, 0.24)";
  renderModeContainer.style.borderRadius = "8px";
  renderModeContainer.style.zIndex = "20";
  renderModeContainer.style.color = "#e7e7e7";
  renderModeContainer.style.fontFamily = "monospace";
  renderModeContainer.style.fontSize = "12px";

  const renderModeLabel = document.createElement("label");
  renderModeLabel.textContent = `${config?.renderViews?.control?.label ?? "Render View"} `;

  const renderModeSelect = document.createElement("select");
  renderModeSelect.style.marginLeft = "6px";
  renderModeSelect.style.background = "#222";
  renderModeSelect.style.color = "#e7e7e7";
  renderModeSelect.style.border = "1px solid #555";
  renderModeSelect.style.borderRadius = "4px";
  renderModeSelect.style.padding = "2px 6px";

  [
    { label: "Colorful", value: "0" },
    { label: "Wireframe", value: "3" },
    { label: "Depth Map (Good Visibility)", value: "1" },
  ].forEach(opt => {
    const option = document.createElement("option");
    option.textContent = opt.label;
    option.value = opt.value;
    renderModeSelect.appendChild(option);
  });

  if (config?.renderViews?.control?.visible === false) {
    renderModeContainer.style.display = "none";
  }

  renderModeLabel.appendChild(renderModeSelect);
  renderModeContainer.appendChild(renderModeLabel);
  document.body.appendChild(renderModeContainer);

  return { renderModeSelect, renderModeContainer };
}

export function getRenderModeNameToValue() {
  return {
    Current: "0",
    "Depth Map": "1",
    Wireframe: "3"
  };
}

export function setupTextureFolder(gui, textureOptions, params, controllers, onApplyTexture) {
  const textureFolder = gui.addFolder("Texture Displacement");

  if (textureOptions.length > 0) {
    controllers.displacementTexture1Controller = addDropdownControl(textureFolder, "displacementTexture1", "Displacement Texture 1", textureOptions.map(t => t.name), params, v => {
      onApplyTexture(v, 1);
    });

    controllers.combinedTextureZoom1Controller = addSliderControl(textureFolder, "combinedTextureZoom1", config?.ui?.combinedTextureZoom1?.label ?? "Combined Texture Zoom 1", config?.ui?.combinedTextureZoom1?.min ?? 0, config?.ui?.combinedTextureZoom1?.max ?? 1, params, v => {
      // Material uniform update handled by caller
    });
  }

  controllers.displacementTexture2Controller = addDropdownControl(textureFolder, "displacementTexture2", "Displacement Texture 2", textureOptions.map(t => t.name), params, v => {
    onApplyTexture(v, 2);
  });

  controllers.combinedTextureZoom2Controller = addSliderControl(textureFolder, "combinedTextureZoom2", config?.ui?.combinedTextureZoom2?.label ?? "Combined Texture Zoom 2", config?.ui?.combinedTextureZoom2?.min ?? 0, config?.ui?.combinedTextureZoom2?.max ?? 1, params, v => {
    // Material uniform update handled by caller
  });
  
  textureFolder.open();
  return textureFolder;
}

export function setupGradientFolder(gui, params, controllers) {
  const gradientFolder = gui.addFolder("Gradient");
  
  controllers.gradientModeController = addDropdownControl(gradientFolder, "gradientMode", "Gradient", ["warmth", "hue spectrum"], params, value => {
    // Material uniform update handled by caller
  });
  
  controllers.gradientPositionController = addSliderControl(gradientFolder, "gradientPosition", "Gradient Position", 0, 1, params, value => {
    // Material uniform update handled by caller
  });
  
  controllers.glossinessController = addSliderControl(gradientFolder, "glossiness", "Glossiness", 0, 1, params, value => {
    // Material uniform update handled by caller
  });
  
  gradientFolder.open();
  return gradientFolder;
}
