import { NgModule, Injectable } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { exec } from 'child_process'
import { BaseTabComponent, ConfigProvider, ConfigService, NewTabParameters, PartialProfile, ProfileProvider, VaultService } from 'tabby-core'
// Type-only: `tabby-ssh` is deliberately NOT a peerDependency. A fresh Tabby
// plugins folder has no tabby-ssh installed, so declaring it as a peer (even
// wildcarded) makes npm auto-install a real copy to satisfy it - and that
// package's Windows postinstall script is currently broken, which breaks
// installing this plugin too. Keep this a type-only import (erased at build
// time, confirmed by dist/index.js never `require`-ing 'tabby-ssh') so it
// stays true.
import type { SSHProfile } from 'tabby-ssh'
import { SettingsTabProvider } from 'tabby-settings'

import { TailscaleConfigProvider } from './config.provider'
import { ResolvedPeerSettings, TailscalePeer, TailscaleStatus, applyRules, passwordSecretFromRef, peerDnsLabel, peerLabelTags } from './models'
import { TailscaleSettingsTabComponent } from './settingsTab.component'
import { TailscaleSettingsTabProvider } from './settingsTab.provider'

function getTailscaleStatus (): Promise<TailscaleStatus> {
    return new Promise((resolve, reject) => {
        exec('tailscale status --json', (err, stdout) => {
            if (err) {
                reject(err)
                return
            }
            try {
                resolve(JSON.parse(stdout))
            } catch (e) {
                reject(e)
            }
        })
    })
}

@Injectable({ providedIn: 'root' })
export class TailscaleProfilesService extends ProfileProvider<SSHProfile> {
    id = 'tailscale'
    name = 'Tabby Tailscale'

    configDefaults = {
        options: {
            host: '',
            port: 22,
            user: 'root',
        },
    }

    constructor (private config: ConfigService, private vault: VaultService) {
        super()
    }

    async getBuiltinProfiles (): Promise<PartialProfile<SSHProfile>[]> {
        let status: TailscaleStatus
        try {
            status = await getTailscaleStatus()
        } catch (e) {
            console.warn('tabby-tailscale: could not read tailscale status', e)
            return []
        }

        const groups = this.config.store.tailscale.groups
        const rules = this.config.store.tailscale.rules
        const onlyTagged = this.config.store.tailscale.onlyTagged
        const naming = {
            tagLabelExcludes: this.config.store.tailscale.tagLabelExcludes,
            showOfflineSuffix: this.config.store.tailscale.showOfflineSuffix,
        }

        return Promise.all(Object.values(status.Peer)
            .filter(peer => !onlyTagged || (peer.Tags?.length ?? 0) > 0)
            .map(peer => ({ peer, settings: applyRules(peer, rules, groups) }))
            .filter(({ settings }) => !settings.excluded)
            .map(({ peer, settings }) => this.peerToProfile(peer, settings, naming)))
    }

    private async peerToProfile (
        peer: TailscalePeer,
        settings: ResolvedPeerSettings,
        naming: { tagLabelExcludes: string[], showOfflineSuffix: boolean },
    ): Promise<PartialProfile<SSHProfile>> {
        const host = peer.DNSName?.replace(/\.$/, '') || peer.TailscaleIPs[0]
        const label = peerDnsLabel(peer)
        const password = await this.resolvePassword(settings.password)

        // Build a "(...)" suffix from whichever other tags the peer has (e.g.
        // its deployment site) plus "offline" if applicable - so new location/
        // customer tags show up automatically without needing a new rule.
        const labelParts = settings.showTagsInName ? peerLabelTags(peer, naming.tagLabelExcludes) : []
        if (!peer.Online && naming.showOfflineSuffix) { labelParts.push('offline') }
        const name = labelParts.length ? `${label} (${labelParts.join(', ')})` : label

        return {
            // peer.ID is Tailscale's stable per-node identifier - used here
            // instead of the DNS label so the profile's identity survives
            // even if Tailscale ever renumbers a disambiguating suffix.
            id: `tailscale:${peer.ID}`,
            type: 'ssh',
            name,
            group: settings.group,
            icon: 'fas fa-share-alt',
            isBuiltin: true,
            isTemplate: false,
            weight: 0,
            options: {
                host,
                port: 22,
                user: settings.user,
                // Leave `auth` unset ('auto'): tabby-ssh then tries the
                // private key (if any), then the SSH agent, then falls back
                // to an interactive password prompt with its own built-in
                // "remember password" option. Forcing 'publicKey' here would
                // suppress that fallback entirely for keyless peers.
                // Keep passing through legacy raw paths (no ://) for backward
                // compatibility; new values are stored as file-provider refs.
                password,
                privateKeys: settings.privateKey ? [settings.privateKey] : [],
            },
        }
    }

    private async resolvePassword (passwordRef?: string): Promise<string|undefined> {
        const secretSpec = passwordSecretFromRef(passwordRef)
        if (!secretSpec) {
            if (passwordRef) {
                console.warn('tabby-tailscale: ignoring invalid password reference')
            }
            return undefined
        }
        return (await this.vault.getSecret(secretSpec.type, secretSpec.key))?.value
    }

    async getNewTabParameters (): Promise<NewTabParameters<BaseTabComponent>> {
        // Never actually called: Tabby dispatches by `provider.id === profile.type`,
        // and our profiles use type 'ssh', so the built-in SSH provider handles them.
        throw new Error('not implemented - handled by the built-in ssh provider')
    }

    getDescription (profile: PartialProfile<SSHProfile>): string {
        return profile.options?.host ?? ''
    }
}

@NgModule({
    imports: [CommonModule, FormsModule],
    declarations: [TailscaleSettingsTabComponent],
    providers: [
        { provide: ProfileProvider, useExisting: TailscaleProfilesService, multi: true },
        { provide: SettingsTabProvider, useClass: TailscaleSettingsTabProvider, multi: true },
        { provide: ConfigProvider, useClass: TailscaleConfigProvider, multi: true },
    ],
})
export default class TailscaleModule { }
