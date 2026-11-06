# Boss Helper Project Rules

## Extension Reload

After building into `.output/chrome-mv3`, run this command in the Boss Helper repository:

```powershell
npm run reload:extension
```

The command uses the existing Native Messaging host and a local Windows named pipe. It asks OfferHunt to reload itself and succeeds only after a different extension boot ID reconnects. No Chrome debugging port or sibling repository is required. Confirm `ok: true` and extension ID `ogkmgjbagackkdlcibcailacnncgonbn`, then refresh the existing BOSS tab through FlowGuide.

On first installation, or after moving the repository or Node, run `npm run diagnostics:install`. If the running extension predates this bridge, open `chrome-extension://ogkmgjbagackkdlcibcailacnncgonbn/workbench.html#reload-extension` through FlowGuide once to activate the built bundle, then retry the command. Reload interrupts active extension work, so finish or stop collection first. The bridge applies to the local Windows Chrome build with `nativeMessaging`, not the store release.

Use only FlowGuide for browser page control. Do not use CUA, direct CDP, or inspect OfferHunt extension-page DOM/localStorage. The native bridge only handles diagnostics and extension self-reload. Do not report a build or BOSS refresh as an extension reload.
