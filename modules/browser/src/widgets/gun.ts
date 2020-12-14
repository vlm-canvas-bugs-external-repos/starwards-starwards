import { NumericProperty, shipProperties } from '../ship-properties';
import { calcShellSecondsToLive, getTarget } from '@starwards/model';
import { getGlobalRoom, getShipRoom } from '../client';

import { Container } from 'golden-layout';
import { DashboardWidget } from './dashboard';
import { InputManager } from '../input-manager';
import { Loop } from '../loop';
import { PropertyPanel } from '../property-panel';

function gunComponent(container: Container, p: Props) {
    void (async () => {
        const [spaceRoom, shipRoom] = await Promise.all([getGlobalRoom('space'), getShipRoom(p.shipId)]);
        let manualShellSecondsToLive = shipRoom.state.chainGun.shellSecondsToLive;
        const loop = new Loop(() => {
            const target = getTarget(shipRoom.state, spaceRoom.state);
            if (target) {
                shipRoom.send('setShellSecondsToLive', {
                    value: calcShellSecondsToLive(shipRoom.state, target.position),
                });
            } else {
                shipRoom.send('setShellSecondsToLive', { value: manualShellSecondsToLive });
            }
        }, 1000 / 10);
        loop.start();
        const panel = new PropertyPanel();
        const input = new InputManager();
        panel.init(container);
        input.init();
        container.on('destroy', () => {
            panel.destroy();
            input.destroy();
        });
        const properties = shipProperties(shipRoom);
        const chainGunPanel = panel.addFolder('chainGun');

        chainGunPanel.addProperty('chainGunCooldown', properties.chainGunCooldown);
        chainGunPanel.addText('chainGunFire', properties.chainGunIsFiring);
        panel.addText('target', properties.target);
        // TODO fix and move to shipManager
        const manualSSTL: NumericProperty = {
            getValue: () => manualShellSecondsToLive,
            range: [shipRoom.state.chainGun.minShellSecondsToLive, shipRoom.state.chainGun.maxShellSecondsToLive],
            onChange: (value: number) => {
                manualShellSecondsToLive = value;
            },
        };
        panel.addProperty('manual shellSecondsToLive', manualSSTL);
        input.addAxisAction(manualSSTL, {
            gamepadIndex: 0,
            axisIndex: 1,
            deadzone: [-0.01, 0.01],
            inverted: true,
        });
        chainGunPanel.addProperty('shellSecondsToLive', properties.chainGunShellSecondsToLive);
    })();
}

export type Props = { shipId: string };
export const gunWidget: DashboardWidget<Props> = {
    name: 'gun',
    type: 'component',
    component: gunComponent,
    defaultProps: {},
};
