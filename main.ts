import { App, Plugin, PluginSettingTab, Setting, MarkdownPostProcessorContext, MarkdownView } from 'obsidian';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { Prec } from '@codemirror/state';

interface SecretMaskSettings {
    prefixDigits: number;
    suffixDigits: number;
    maskChar: string;
}

const DEFAULT_SETTINGS: SecretMaskSettings = {
    prefixDigits: 3,
    suffixDigits: 4,
    maskChar: '*'
};

const CODE_REGEX = /^`?sdk:(\d+)`?$/;

function maskValue(value: string, settings: SecretMaskSettings): string {
    const { prefixDigits, suffixDigits, maskChar } = settings;
    if (value.length <= prefixDigits + suffixDigits) {
        return value;
    }
    const prefix = value.slice(0, prefixDigits);
    const suffix = value.slice(-suffixDigits);
    const maskLength = value.length - prefixDigits - suffixDigits;
    return prefix + maskChar.repeat(maskLength) + suffix;
}

class MaskWidget extends WidgetType {
    constructor(
        private masked: string,
        private full: string
    ) {
        super();
    }

    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.className = 'secret-mask';
        span.textContent = this.masked;
        span.setAttribute('data-full-number', this.full);
        return span;
    }

    eq(other: MaskWidget): boolean {
        return this.masked === other.masked && this.full === other.full;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

export default class SecretMaskPlugin extends Plugin {
    settings: SecretMaskSettings;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new SecretMaskSettingTab(this.app, this));

        this.registerMarkdownPostProcessor((el, ctx) => this.processReadingView(el));

        this.registerEditorExtension(Prec.highest(this.buildLivePreviewPlugin()));

        window.addEventListener('mouseover', this.handleMouseOver, true);
        window.addEventListener('mouseout', this.handleMouseOut, true);
        window.addEventListener('copy', this.handleCopy, true);
        window.addEventListener('scroll', this.handleScroll, true);

        this.register(() => {
            window.removeEventListener('mouseover', this.handleMouseOver, true);
            window.removeEventListener('mouseout', this.handleMouseOut, true);
            window.removeEventListener('copy', this.handleCopy, true);
            window.removeEventListener('scroll', this.handleScroll, true);
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    processReadingView(el: HTMLElement, ctx?: MarkdownPostProcessorContext) {
        const codeElements = el.querySelectorAll('code');
        codeElements.forEach(code => {
            const text = (code.textContent || '').trim();
            const match = text.match(CODE_REGEX);
            if (!match) return;

            const fullNumber = match[1];
            const masked = maskValue(fullNumber, this.settings);

            const span = document.createElement('span');
            span.className = 'secret-mask';
            span.textContent = masked;
            span.setAttribute('data-full-number', fullNumber);
            code.replaceWith(span);
        });
    }

    buildLivePreviewPlugin() {
        const plugin = this;

        return ViewPlugin.fromClass(class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = this.buildDecorations(view);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged || update.selectionSet) {
                    this.decorations = this.buildDecorations(update.view);
                }
            }

            buildDecorations(view: EditorView): DecorationSet {
                const decorations = [];
                const selection = view.state.selection;
                const overlapsSelection = (from: number, to: number): boolean => {
                    for (let i = 0; i < selection.ranges.length; i++) {
                        const r = selection.ranges[i];
                        if (r.from <= to && r.to >= from) return true;
                    }
                    return false;
                };

                for (const { from, to } of view.visibleRanges) {
                    const text = view.state.doc.sliceString(from, to);
                    const regex = /`sdk:(\d+)`/g;
                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        const fullNumber = match[1];
                        const start = from + match.index;
                        const end = start + match[0].length;
                        if (overlapsSelection(start, end)) continue;
                        decorations.push(
                            Decoration.replace({
                                widget: new MaskWidget(maskValue(fullNumber, plugin.settings), fullNumber)
                            }).range(start, end)
                        );
                    }
                }

                return Decoration.set(decorations);
            }
        }, {
            decorations: v => v.decorations
        });
    }

    handleMouseOver = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target || !target.classList) return;
        if (target.classList.contains('secret-mask')) {
            const fullNumber = target.getAttribute('data-full-number');
            if (fullNumber) this.showTooltip(e, fullNumber);
        } else {
            this.hideTooltip();
        }
    };

    handleMouseOut = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target || !target.classList) return;
        if (target.classList.contains('secret-mask')) {
            this.hideTooltip();
        }
    };

    handleScroll = () => {
        this.hideTooltip();
    };

    showTooltip(e: MouseEvent, text: string) {
        this.hideTooltip();
        const tooltip = document.createElement('div');
        tooltip.className = 'secret-mask-tooltip';
        tooltip.id = 'secret-mask-tooltip';
        tooltip.textContent = text;
        tooltip.style.position = 'fixed';
        tooltip.style.left = `${e.clientX}px`;
        tooltip.style.top = `${e.clientY - 30}px`;
        tooltip.style.background = 'var(--background-primary)';
        tooltip.style.color = 'var(--text-normal)';
        tooltip.style.padding = '4px 8px';
        tooltip.style.borderRadius = '4px';
        tooltip.style.border = '1px solid var(--background-modifier-border)';
        tooltip.style.zIndex = '1000';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.fontSize = 'var(--font-small)';
        document.body.appendChild(tooltip);
    }

    hideTooltip() {
        const tooltip = document.getElementById('secret-mask-tooltip');
        if (tooltip) tooltip.remove();
    }

    getMaskedSpansInRange(range: Range): HTMLElement[] {
        const result: HTMLElement[] = [];
        document.querySelectorAll('.secret-mask').forEach(el => {
            try {
                if (range.intersectsNode(el)) result.push(el as HTMLElement);
            } catch (err) {
                // ignore
            }
        });
        return result;
    }

    handleCopy = (e: ClipboardEvent) => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const spans = this.getMaskedSpansInRange(range);
        if (spans.length === 0) return;

        const saved = spans.map(el => el.textContent || '');
        spans.forEach(el => {
            const full = el.getAttribute('data-full-number');
            if (full) el.textContent = full;
        });

        let plainText = selection.toString();

        // Live preview: browser selection over an atomic widget can be empty.
        // Fall back to the CodeMirror source selection.
        if (!plainText.replace(/\s/g, '')) {
            const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
            const src = mdView?.editor?.getSelection?.() ?? '';
            const replaced = src.replace(/`sdk:(\d+)`/g, '$1');
            if (replaced !== src) plainText = replaced;
        }

        if (e.clipboardData && plainText.replace(/\s/g, '')) {
            e.preventDefault();
            e.clipboardData.setData('text/plain', plainText);
        }

        setTimeout(() => {
            spans.forEach((el, i) => { el.textContent = saved[i]; });
        }, 0);
    };
}

class SecretMaskSettingTab extends PluginSettingTab {
    plugin: SecretMaskPlugin;

    constructor(app: App, plugin: SecretMaskPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Secret Mask Settings' });

        new Setting(containerEl)
            .setName('Prefix digits')
            .setDesc('Number of digits to show at the beginning')
            .addText(text => text
                .setPlaceholder('3')
                .setValue(String(this.plugin.settings.prefixDigits))
                .onChange(async (value) => {
                    this.plugin.settings.prefixDigits = parseInt(value) || 3;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Suffix digits')
            .setDesc('Number of digits to show at the end')
            .addText(text => text
                .setPlaceholder('4')
                .setValue(String(this.plugin.settings.suffixDigits))
                .onChange(async (value) => {
                    this.plugin.settings.suffixDigits = parseInt(value) || 4;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Mask character')
            .setDesc('Character used for masking')
            .addText(text => text
                .setPlaceholder('*')
                .setValue(this.plugin.settings.maskChar)
                .onChange(async (value) => {
                    this.plugin.settings.maskChar = value || '*';
                    await this.plugin.saveSettings();
                }));
    }
}
