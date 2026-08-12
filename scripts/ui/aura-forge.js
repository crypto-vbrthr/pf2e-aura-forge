import { MODULE_ID } from "../constants.js";
import { AuraForgeApp } from "./aura-forge-app.js";

let app = null;

export async function openAuraForge() {
  if (!game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize("PF2E_AURA_FORGE.Notifications.GmOnly"));
    return null;
  }
  if (!app) {
    app = new AuraForgeApp();
    await app.initialize();
  }
  await app.render({ force: true });
  app.bringToFront?.();
  return app;
}

function getRoot(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (html?.element instanceof HTMLElement) return html.element;
  return null;
}

function isItemDirectory(appRef, root) {
  const tabName = appRef?.tabName ?? appRef?.options?.tabName ?? appRef?.id ?? "";
  if (String(tabName).toLowerCase().includes("item")) return true;
  return Boolean(root?.matches?.("#items, .items-directory") || root?.querySelector?.("#items, .items-directory"));
}

function injectButton(appRef, html) {
  if (!game.user?.isGM) return;
  const root = getRoot(html);
  if (!root || !isItemDirectory(appRef, root)) return;
  if (root.querySelector(`[data-${MODULE_ID}-button]`)) return;

  const target = [
    ".directory-header .header-actions",
    ".directory-header .action-buttons",
    ".directory-header",
    ".header-actions",
    "header"
  ].map((selector) => root.querySelector(selector)).find(Boolean);
  if (!target) return;

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(`data-${MODULE_ID}-button`, "");
  button.className = "pf2e-aura-forge-open";
  button.innerHTML = `<i class="fa-solid fa-circle-nodes"></i> ${game.i18n.localize("PF2E_AURA_FORGE.Open")}`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    openAuraForge();
  });
  target.append(button);
}

export function initializeAuraForgeUi() {
  Hooks.on("renderItemDirectory", injectButton);
  Hooks.on("renderSidebarTab", injectButton);
  const current = document.querySelector("#items, .items-directory");
  if (current) injectButton({ tabName: "items" }, current);
  console.info(`${MODULE_ID} | Aura Forge UI integration initialized.`);
}
