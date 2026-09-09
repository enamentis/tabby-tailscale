export interface TailscalePeer {
    ID: string
    DNSName: string
    TailscaleIPs: string[]
    Online: boolean
    HostName: string
    Tags?: string[]
}

export interface TailscaleStatus {
    Peer: Record<string, TailscalePeer> | null
}

export interface TailscaleGroup {
    id: string
    name: string
    user?: string
    // Prefer a FileProvidersService reference (e.g. file://... or vault://...).
    // Legacy raw paths (without ://) are still accepted for backward compatibility.
    privateKey?: string
    // Opaque VaultService marker (e.g. vault:group-password:...), never plaintext.
    password?: string
}

export interface TailscaleRule {
    id: string
    description?: string    // free-text note, purely for your own reference - has no effect on matching
    hostnameRegex?: string
    tagRegex?: string
    onlineStatus?: 'online' | 'offline'    // unset = match regardless of online status
    exclude?: boolean
    group?: string      // references a TailscaleGroup.name; supports $1, $2... from hostnameRegex capture groups
    user?: string
    // Prefer a FileProvidersService reference (e.g. file://... or vault://...).
    // Legacy raw paths (without ://) are still accepted for backward compatibility.
    privateKey?: string
    // Opaque VaultService marker (e.g. vault:rule-password:...), never plaintext.
    password?: string
    showTagsInName?: boolean    // append the peer's other tags (minus tagLabelExcludes) to its profile name
}

export interface TailscaleConfig {
    groups: TailscaleGroup[]
    rules: TailscaleRule[]
    onlyTagged: boolean
    tagLabelExcludes: string[]    // tags never shown by showTagsInName (e.g. a marker tag you matched a rule on)
    showOfflineSuffix: boolean    // append "(offline)" to offline peers' names
}

export interface ResolvedPeerSettings {
    excluded: boolean
    group?: string
    user?: string
    privateKey?: string
    password?: string
    showTagsInName?: boolean
}

export const DEFAULT_GROUP = 'Tailscale'
export const DEFAULT_USER = 'root'
export const GROUP_PASSWORD_SECRET_TYPE = 'tailscale:group-password'
export const RULE_PASSWORD_SECRET_TYPE = 'tailscale:rule-password'
const GROUP_PASSWORD_REF_PREFIX = 'vault:group-password:'
const RULE_PASSWORD_REF_PREFIX = 'vault:rule-password:'

export function newId (): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID()
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function groupPasswordRef (id: string): string {
    return `${GROUP_PASSWORD_REF_PREFIX}${id}`
}

export function rulePasswordRef (id: string): string {
    return `${RULE_PASSWORD_REF_PREFIX}${id}`
}

export function passwordSecretFromRef (ref?: string): { type: string, key: { id: string } } | null {
    if (!ref) {
        return null
    }
    if (ref.startsWith(GROUP_PASSWORD_REF_PREFIX)) {
        return {
            type: GROUP_PASSWORD_SECRET_TYPE,
            key: { id: ref.substring(GROUP_PASSWORD_REF_PREFIX.length) },
        }
    }
    if (ref.startsWith(RULE_PASSWORD_REF_PREFIX)) {
        return {
            type: RULE_PASSWORD_SECRET_TYPE,
            key: { id: ref.substring(RULE_PASSWORD_REF_PREFIX.length) },
        }
    }
    return null
}

/**
 * The peer's Tailscale MagicDNS label (e.g. "oci-dev-services-playground-vm-1"),
 * stripped of the trailing dot and the tailnet domain suffix. Unlike
 * peer.HostName, this is guaranteed unique within the tailnet - Tailscale
 * itself appends a disambiguating "-1", "-2"... suffix here when multiple
 * peers register the same hostname.
 */
export function peerDnsLabel (peer: TailscalePeer): string {
    const dns = peer.DNSName?.replace(/\.$/, '')
    return dns ? dns.split('.')[0] : (peer.HostName ?? '')
}

/**
 * The peer's tags with the "tag:" prefix stripped and any tag listed in
 * `excludes` removed (case-insensitive) - used to build the "(...)" suffix
 * that showTagsInName appends to a profile name.
 */
export function peerLabelTags (peer: TailscalePeer, excludes: string[]): string[] {
    const excludeSet = new Set(excludes.map(t => t.toLowerCase()))
    return (peer.Tags ?? [])
        .map(t => t.replace(/^tag:/, ''))
        .filter(t => !excludeSet.has(t.toLowerCase()))
}

/**
 * Returns a human-readable error if `pattern` isn't a valid JS regex, or
 * null if it's fine (including empty/undefined, which just means "no filter").
 */
export function regexError (pattern?: string): string | null {
    if (!pattern) { return null }
    try {
        new RegExp(pattern)
        return null
    } catch (e) {
        return e instanceof Error ? e.message : String(e)
    }
}

/**
 * Resolves a peer's group/user/privateKey/password by cascading matching rules
 * (later matches override earlier ones, top to bottom), then falling back
 * to the resolved group's own defaults, then to hardcoded defaults.
 */
export function applyRules (peer: TailscalePeer, rules: TailscaleRule[], groups: TailscaleGroup[]): ResolvedPeerSettings {
    const hostname = peerDnsLabel(peer)
    const tags = (peer.Tags ?? []).join(',')

    const result: ResolvedPeerSettings = { excluded: false }

    for (const rule of rules) {
        let hostnameMatch: RegExpExecArray | null = null

        if (rule.onlineStatus === 'online' && !peer.Online) { continue }
        if (rule.onlineStatus === 'offline' && peer.Online) { continue }

        if (rule.hostnameRegex) {
            try {
                // Case-insensitive: DNS labels are lowercase regardless of
                // the device's actual HostName casing.
                hostnameMatch = new RegExp(rule.hostnameRegex, 'i').exec(hostname)
            } catch (e) {
                console.warn(`tabby-tailscale: rule ${rule.id} has an invalid hostname regex (${rule.hostnameRegex}) - skipping rule`, e)
                continue
            }
            if (!hostnameMatch) { continue }
        }
        if (rule.tagRegex) {
            try {
                if (!new RegExp(rule.tagRegex, 'i').test(tags)) { continue }
            } catch (e) {
                console.warn(`tabby-tailscale: rule ${rule.id} has an invalid tag regex (${rule.tagRegex}) - skipping rule`, e)
                continue
            }
        }

        // `exclude` cascades like every other field below - a later matching
        // rule with the checkbox explicitly unchecked (exclude: false) can
        // un-exclude a peer an earlier rule excluded. Only an explicit true
        // or false counts; leaving it unset means "don't touch".
        if (rule.exclude !== undefined) {
            result.excluded = rule.exclude
        }

        if (rule.group) {
            result.group = rule.group.replace(/\$(\d+)/g, (_, i) => hostnameMatch?.[+i] ?? '')
        }
        if (rule.user) { result.user = rule.user }
        if (rule.privateKey) { result.privateKey = rule.privateKey }
        if (rule.password) { result.password = rule.password }
        if (rule.showTagsInName !== undefined) { result.showTagsInName = rule.showTagsInName }
    }

    if (!result.excluded) {
        const group = result.group ? groups.find(g => g.name === result.group) : undefined
        if (group) {
            result.user ??= group.user
            result.privateKey ??= group.privateKey
            result.password ??= group.password
        }
        result.group ??= DEFAULT_GROUP
        result.user ??= DEFAULT_USER
    }

    return result
}
