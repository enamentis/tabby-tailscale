import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'
import { TailscaleSettingsTabComponent } from './settingsTab.component'

@Injectable()
export class TailscaleSettingsTabProvider extends SettingsTabProvider {
    id = 'tailscale'
    icon = 'share-alt'
    title = 'Tailscale'

    getComponentType (): any {
        return TailscaleSettingsTabComponent
    }
}
