import { Component } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { ConfigService, FileProvidersService, PromptModalComponent, VaultService } from 'tabby-core'
import {
    GROUP_PASSWORD_SECRET_TYPE,
    RULE_PASSWORD_SECRET_TYPE,
    TailscaleGroup,
    TailscaleRule,
    groupPasswordRef,
    newId,
    regexError,
    rulePasswordRef,
} from './models'

@Component({
    selector: 'tailscale-settings-tab',
    template: `
    <div class="tailscale-settings">
        <div class="disclaimer">
            <strong>Unofficial plugin.</strong> "Tabby Tailscale" is a third-party
            Tabby plugin and is not made, endorsed, or supported by Tailscale Inc.
        </div>

        <p class="explainer">
            This plugin runs <code>tailscale status --json</code> and turns your online peers
            into SSH profiles, refreshed every time the Profile Browser is opened. Use
            <strong>Rules</strong> to match peers by hostname and/or tag (regex) and decide what
            happens to them: exclude them, assign them to a <strong>Group</strong>, and/or
            override their username, password, or private key directly. Rules are evaluated
            top to bottom - if more than one rule matches a peer, later rules override earlier
            ones for whichever fields they set. Anything a rule leaves blank falls back to the
            peer's assigned group, then to hardcoded defaults (user: root, no password, no
            private key). Each group name also becomes its own visible, collapsible folder in
            the Profile Browser.
        </p>

        <label class="only-tagged-toggle">
            <input type="checkbox" [(ngModel)]="onlyTagged" (change)="save()">
            Only list peers that have at least one tag
        </label>

        <label class="tag-label-excludes">
            Tags to hide from name labels (comma-separated):
            <input type="text" placeholder="e.g. prod" [(ngModel)]="tagLabelExcludesText" (change)="saveTagLabelExcludes()">
        </label>
        <p class="hint">
            Used by a rule's "Show remaining tags in name" option below - every other tag
            the peer has (e.g. its deployment site) gets appended to its profile name,
            except the ones listed here.
        </p>

        <label class="only-tagged-toggle">
            <input type="checkbox" [(ngModel)]="showOfflineSuffix" (change)="save()">
            Show "(offline)" in the name of offline peers
        </label>

        <h3>Groups</h3>
        <p class="hint">
            Each group is a folder in the Profile Browser and a set of default connection
            settings. Rules below can assign peers to a group and override its defaults.
        </p>
        <div class="group-card" *ngFor="let group of groups; trackBy: trackById">
            <div class="card-header-row">
                <input type="text" placeholder="Name" [(ngModel)]="group.name" (change)="save()">
                <button (click)="removeGroup(group)">Remove</button>
            </div>
            <details class="details-panel">
                <summary>Defaults</summary>
                <div class="details-body">
                    <input type="text" placeholder="User (default: root)" [(ngModel)]="group.user" (change)="save()">
                    <div class="action-row">
                        <button (click)="pickGroupPrivateKey(group)">Select private key</button>
                        <button (click)="clearGroupPrivateKey(group)" [disabled]="!group.privateKey">Clear key</button>
                        <span class="secret-ref" *ngIf="group.privateKey">{{ privateKeyLabel(group.privateKey) }}</span>
                    </div>
                    <div class="action-row">
                        <button (click)="setGroupPassword(group)" [disabled]="!vault.isEnabled()">Set password</button>
                        <button (click)="clearGroupPassword(group)" [disabled]="!vault.isEnabled() || !group.password">Clear password</button>
                        <span class="secret-ref" *ngIf="group.password">Stored in Vault</span>
                    </div>
                    <p class="vault-hint" *ngIf="!vault.isEnabled()">
                        Password storage requires Tabby's Vault to be enabled in Settings → Vault.
                    </p>
                </div>
            </details>
        </div>
        <button (click)="addGroup()">+ Add group</button>

        <h3>Rules</h3>
        <p class="hint">
            Evaluated top to bottom - later matching rules override earlier ones for any field
            they set. Fields left blank fall back to the assigned group, then to defaults
            (user: root, no password, no private key).
        </p>
        <div class="rule-card" *ngFor="let rule of rules; let i = index; trackBy: trackById">
            <div class="card-header-row">
                <input type="text" class="rule-description" placeholder="Description (optional, for your own reference)"
                       [(ngModel)]="rule.description" (change)="save()">
                <div class="rule-order">
                    <button (click)="moveRuleUp(i)" [disabled]="i === 0">&uarr;</button>
                    <button (click)="moveRuleDown(i)" [disabled]="i === rules.length - 1">&darr;</button>
                </div>
                <button (click)="removeRule(rule)">Remove</button>
            </div>
            <div class="rule-matchers">
                <input type="text" placeholder="Hostname regex" [(ngModel)]="rule.hostnameRegex" (change)="save()"
                       [class.invalid]="regexError(rule.hostnameRegex)"
                       [title]="regexError(rule.hostnameRegex)">
                <input type="text" placeholder="Tag regex" [(ngModel)]="rule.tagRegex" (change)="save()"
                       [class.invalid]="regexError(rule.tagRegex)"
                       [title]="regexError(rule.tagRegex)">
                <select [(ngModel)]="rule.onlineStatus" (change)="save()" title="Filter by online status">
                    <option [ngValue]="undefined">Online: any</option>
                    <option [ngValue]="'online'">Online only</option>
                    <option [ngValue]="'offline'">Offline only</option>
                </select>
                <label class="exclude-toggle">
                    <input type="checkbox" [(ngModel)]="rule.exclude" (change)="save()"> Exclude
                </label>
            </div>
            <details class="details-panel" *ngIf="!rule.exclude">
                <summary>Overrides</summary>
                <div class="details-body">
                    <select [(ngModel)]="rule.group" (change)="save()">
                        <option [ngValue]="undefined">(no group)</option>
                        <option *ngFor="let group of groups" [ngValue]="group.name">{{ group.name }}</option>
                    </select>
                    <input type="text" placeholder="User override" [(ngModel)]="rule.user" (change)="save()">
                    <div class="action-row">
                        <button (click)="pickRulePrivateKey(rule)">Select private key override</button>
                        <button (click)="clearRulePrivateKey(rule)" [disabled]="!rule.privateKey">Clear key override</button>
                        <span class="secret-ref" *ngIf="rule.privateKey">{{ privateKeyLabel(rule.privateKey) }}</span>
                    </div>
                    <div class="action-row">
                        <button (click)="setRulePassword(rule)" [disabled]="!vault.isEnabled()">Set password override</button>
                        <button (click)="clearRulePassword(rule)" [disabled]="!vault.isEnabled() || !rule.password">Clear password override</button>
                        <span class="secret-ref" *ngIf="rule.password">Stored in Vault</span>
                    </div>
                    <label class="show-tags-toggle">
                        <input type="checkbox" [(ngModel)]="rule.showTagsInName" (change)="save()">
                        Show remaining tags in name
                    </label>
                    <p class="vault-hint" *ngIf="!vault.isEnabled()">
                        Password storage requires Tabby's Vault to be enabled in Settings → Vault.
                    </p>
                </div>
            </details>
        </div>
        <button (click)="addRule()">+ Add rule</button>

        <div class="regex-tips">
            <strong>Useful regex patterns</strong>
            <ul>
                <li><code>prod</code> - contains "prod" (matching is substring-based, case-insensitive)</li>
                <li><code>^(?!.*prod)</code> - does <em>not</em> contain "prod" (negative lookahead)</li>
                <li><code>foo|bar</code> - contains "foo" OR "bar"</li>
                <li><code>-\\d+$</code> - ends with a dash and a number (Tailscale's disambiguating suffix for duplicate hostnames)</li>
                <li><code>^exact-name$</code> - matches only that exact hostname/DNS label</li>
                <li><code>^prefix</code> / <code>suffix$</code> - starts with / ends with</li>
            </ul>
        </div>
    </div>
    `,
    styles: [`
        .tailscale-settings h3 { margin-top: 1.5em; }
        .tailscale-settings .hint { opacity: 0.7; font-size: 0.9em; }
        .disclaimer {
            background: rgba(255, 193, 7, 0.15);
            border: 1px solid rgba(255, 193, 7, 0.4);
            border-radius: 4px;
            padding: 0.6em 0.8em;
            margin-bottom: 1em;
        }
        .explainer { opacity: 0.85; line-height: 1.5; margin-bottom: 1em; }
        .only-tagged-toggle { display: flex; align-items: center; gap: 0.4em; margin-bottom: 1em; }
        .tag-label-excludes { display: flex; align-items: center; gap: 0.5em; }
        .tag-label-excludes input { flex: 1 1 200px; max-width: 300px; }
        .show-tags-toggle, .exclude-toggle {
            display: flex;
            align-items: center;
            gap: 0.3em;
            white-space: nowrap;
        }
        .group-card, .rule-card {
            border: 1px solid rgba(128, 128, 128, 0.3);
            border-radius: 6px;
            padding: 0.6em 0.7em;
            margin-bottom: 0.75em;
        }
        .card-header-row, .rule-matchers, .details-body, .action-row {
            display: flex;
            gap: 0.5em;
            align-items: center;
            flex-wrap: wrap;
        }
        .card-header-row input,
        .rule-matchers input,
        .rule-matchers select,
        .details-body input,
        .details-body select {
            flex: 1 1 180px;
        }
        .rule-description {
            flex: 1 1 280px;
            font-style: italic;
        }
        .rule-order { display: flex; flex-direction: column; }
        .details-panel { margin-top: 0.5em; }
        .details-panel summary {
            cursor: pointer;
            opacity: 0.8;
            margin-bottom: 0.5em;
        }
        .details-body { align-items: flex-start; }
        .action-row { flex: 1 1 100%; }
        .secret-ref { opacity: 0.7; font-size: 0.85em; }
        .vault-hint {
            margin: 0;
            opacity: 0.75;
            font-size: 0.85em;
        }
        input.invalid { border-color: #e55; background: rgba(238, 85, 85, 0.1); }
        .regex-tips {
            margin-top: 1.25em;
            padding: 0.6em 0.9em;
            border: 1px solid rgba(128, 128, 128, 0.3);
            border-radius: 6px;
            font-size: 0.9em;
            opacity: 0.85;
        }
        .regex-tips ul { margin: 0.4em 0 0 0; padding-left: 1.2em; }
        .regex-tips li { margin-bottom: 0.25em; }
    `],
})
export class TailscaleSettingsTabComponent {
    groups: TailscaleGroup[] = []
    rules: TailscaleRule[] = []
    onlyTagged = false
    tagLabelExcludes: string[] = []
    tagLabelExcludesText = ''
    showOfflineSuffix = true

    constructor (
        private config: ConfigService,
        private fileProviders: FileProvidersService,
        private ngbModal: NgbModal,
        public vault: VaultService,
    ) {
        this.groups = this.config.store.tailscale.groups
        this.rules = this.config.store.tailscale.rules
        this.onlyTagged = this.config.store.tailscale.onlyTagged
        this.tagLabelExcludes = this.config.store.tailscale.tagLabelExcludes
        this.tagLabelExcludesText = this.tagLabelExcludes.join(', ')
        this.showOfflineSuffix = this.config.store.tailscale.showOfflineSuffix
    }

    trackById (_index: number, item: { id: string }): string {
        return item.id
    }

    regexError (pattern?: string): string | null {
        return regexError(pattern)
    }

    addGroup (): void {
        this.groups.push({ id: newId(), name: 'New group' })
        this.save()
    }

    removeGroup (group: TailscaleGroup): void {
        this.groups = this.groups.filter(g => g !== group)
        this.save()
    }

    addRule (): void {
        this.rules.push({ id: newId() })
        this.save()
    }

    removeRule (rule: TailscaleRule): void {
        this.rules = this.rules.filter(r => r !== rule)
        this.save()
    }

    moveRuleUp (index: number): void {
        if (index <= 0) { return }
        [this.rules[index - 1], this.rules[index]] = [this.rules[index], this.rules[index - 1]]
        this.save()
    }

    moveRuleDown (index: number): void {
        if (index >= this.rules.length - 1) { return }
        [this.rules[index + 1], this.rules[index]] = [this.rules[index], this.rules[index + 1]]
        this.save()
    }

    async pickGroupPrivateKey (group: TailscaleGroup): Promise<void> {
        const keyRef = await this.fileProviders.selectAndStoreFile(`private key for group ${group.name || 'group'}`).catch(() => null)
        if (keyRef) {
            group.privateKey = keyRef
            this.save()
        }
    }

    clearGroupPrivateKey (group: TailscaleGroup): void {
        delete group.privateKey
        this.save()
    }

    async setGroupPassword (group: TailscaleGroup): Promise<void> {
        await this.setPassword(`Password for group ${group.name || 'group'}`, async password => {
            await this.vault.addSecret({
                type: GROUP_PASSWORD_SECRET_TYPE,
                key: { id: group.id },
                value: password,
            })
            group.password = groupPasswordRef(group.id)
            this.save()
        })
    }

    async clearGroupPassword (group: TailscaleGroup): Promise<void> {
        try {
            await this.vault.removeSecret(GROUP_PASSWORD_SECRET_TYPE, { id: group.id })
            delete group.password
            this.save()
        } catch { }
    }

    async pickRulePrivateKey (rule: TailscaleRule): Promise<void> {
        const keyRef = await this.fileProviders.selectAndStoreFile(`private key for rule ${rule.description || rule.id}`).catch(() => null)
        if (keyRef) {
            rule.privateKey = keyRef
            this.save()
        }
    }

    clearRulePrivateKey (rule: TailscaleRule): void {
        delete rule.privateKey
        this.save()
    }

    async setRulePassword (rule: TailscaleRule): Promise<void> {
        await this.setPassword(`Password override for rule ${rule.description || rule.id}`, async password => {
            await this.vault.addSecret({
                type: RULE_PASSWORD_SECRET_TYPE,
                key: { id: rule.id },
                value: password,
            })
            rule.password = rulePasswordRef(rule.id)
            this.save()
        })
    }

    async clearRulePassword (rule: TailscaleRule): Promise<void> {
        try {
            await this.vault.removeSecret(RULE_PASSWORD_SECRET_TYPE, { id: rule.id })
            delete rule.password
            this.save()
        } catch { }
    }

    privateKeyLabel (keyRef: string): string {
        return keyRef.includes('://') ? keyRef : `legacy path: ${keyRef}`
    }

    saveTagLabelExcludes (): void {
        this.tagLabelExcludes = this.tagLabelExcludesText.split(',').map(t => t.trim()).filter(Boolean)
        this.save()
    }

    save (): void {
        // `config.store.tailscale` is a nested ConfigProxy (registered via
        // TailscaleConfigProvider) - it must be mutated per-key, not replaced
        // wholesale, or the write never reaches the underlying store that
        // gets persisted to config.yaml.
        this.config.store.tailscale.groups = this.groups
        this.config.store.tailscale.rules = this.rules
        this.config.store.tailscale.onlyTagged = this.onlyTagged
        this.config.store.tailscale.tagLabelExcludes = this.tagLabelExcludes
        this.config.store.tailscale.showOfflineSuffix = this.showOfflineSuffix
        this.config.save()
    }

    private async setPassword (prompt: string, onSave: (password: string) => Promise<void>): Promise<void> {
        if (!this.vault.isEnabled()) {
            return
        }
        const modal = this.ngbModal.open(PromptModalComponent)
        modal.componentInstance.prompt = prompt
        modal.componentInstance.password = true
        try {
            const result = await modal.result.catch(() => null)
            if (result?.value) {
                await onSave(result.value)
            }
        } catch { }
    }
}
