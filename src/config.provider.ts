import { ConfigProvider } from 'tabby-core'

/**
 * Registers the `tailscale` config key's defaults with Tabby's ConfigService.
 * Without this, `config.store.tailscale` is never wired into the underlying
 * store the ConfigProxy persists - reads/writes on it would silently operate
 * on a disconnected property that never reaches config.yaml.
 */
export class TailscaleConfigProvider extends ConfigProvider {
    defaults = {
        tailscale: {
            groups: [],
            rules: [],
            onlyTagged: false,
            tagLabelExcludes: [],
            showOfflineSuffix: true,
        },
    }

    platformDefaults = {}
}
