import { App, PluginSettingTab, Setting } from 'obsidian';

export interface PluginSettings {
    defaultFps: number;
    defaultWidth: number;
    defaultHeight: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
    defaultFps: 30,
    defaultWidth: 1920,
    defaultHeight: 1080,
};

export class RemotionSettingTab extends PluginSettingTab {
    plugin: any;

    constructor(app: App, plugin: any) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        containerEl.createEl('h2', { text: 'Remotion Preview Settings' });

        new Setting(containerEl)
            .setName('Default FPS')
            .setDesc('Default frames per second for Remotion compositions.')
            .addText(text => text
                .setValue(String(this.plugin.settings.defaultFps))
                .onChange(async (value) => {
                    const fps = parseInt(value);
                    if (!isNaN(fps) && fps > 0) {
                        this.plugin.settings.defaultFps = fps;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Default Width')
            .setDesc('Default composition width in pixels.')
            .addText(text => text
                .setValue(String(this.plugin.settings.defaultWidth))
                .onChange(async (value) => {
                    const width = parseInt(value);
                    if (!isNaN(width) && width > 0) {
                        this.plugin.settings.defaultWidth = width;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Default Height')
            .setDesc('Default composition height in pixels.')
            .addText(text => text
                .setValue(String(this.plugin.settings.defaultHeight))
                .onChange(async (value) => {
                    const height = parseInt(value);
                    if (!isNaN(height) && height > 0) {
                        this.plugin.settings.defaultHeight = height;
                        await this.plugin.saveSettings();
                    }
                }));
    }
}
