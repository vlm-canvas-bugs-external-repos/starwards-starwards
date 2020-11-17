import { SpaceObject } from '@starwards/model';
import { Container } from 'golden-layout';
import * as PIXI from 'pixi.js';
import WebFont from 'webfontloader';
import { getGlobalRoom, getShipRoom, NamedGameRoom } from '../client';
import { blipRenderer } from '../radar/blip-renderer';
import { Camera } from '../radar/camera';
import { CameraView } from '../radar/camera-view';
import { ObjectsLayer } from '../radar/objects-layer';
import { RangeIndicators } from '../radar/range-indicators';
import { crosshairs, speedLines } from '../radar/tactical-radar-layers';
import { trackTargetObject } from '../ship-logic';
import { DashboardWidget } from './dashboard';

WebFont.load({
    custom: {
        families: ['Bebas'],
    },
});

export const preloadList = ['images/crosshair1.png'];

PIXI.Loader.shared.add(preloadList);

const sizeFactor = 0.85; // 15% left for azimut circle
const sizeFactorGrace = 0.005;

function tacticalRadarComponent(container: Container, state: Props) {
    const camera = new Camera();
    camera.bindRange(container, sizeFactor - sizeFactorGrace, state);
    async function init() {
        const root = new CameraView({ backgroundColor: 0x0f0f0f }, camera, container);
        root.setSquare();
        const range = new RangeIndicators(root, state.range / 5);
        range.setSizeFactor(sizeFactor);
        root.addLayer(range.renderRoot);
        const [spaceRoom, shipRoom] = await Promise.all([getGlobalRoom('space'), getShipRoom(state.subjectId)]);
        const shipTarget = trackTargetObject(spaceRoom.state, shipRoom.state);
        root.addLayer(crosshairs(root, shipRoom.state, shipTarget));
        root.addLayer(speedLines(root, shipRoom.state, shipTarget));
        const blipLayer = new ObjectsLayer(root, spaceRoom, blipRenderer, shipTarget);
        root.addLayer(blipLayer.renderRoot);
        trackObject(camera, spaceRoom, state.subjectId);
    }

    PIXI.Loader.shared.load(() => {
        void init();
    });
}

function trackObject(camera: Camera, room: NamedGameRoom<'space'>, subjectId: string) {
    let tracked = room.state.get(subjectId);
    if (tracked) {
        camera.followSpaceObject(tracked, room.state.events, true);
    } else {
        room.state.events.on('add', (spaceObject: SpaceObject) => {
            if (!tracked && spaceObject.id === subjectId) {
                tracked = spaceObject;
                camera.followSpaceObject(tracked, room.state.events, true);
            }
        });
    }
}

export type Props = { range: number; subjectId: string };
export const tacticalRadarWidget: DashboardWidget<Props> = {
    name: 'tactical radar',
    type: 'component',
    component: tacticalRadarComponent,
    defaultProps: { range: 5000 },
};
