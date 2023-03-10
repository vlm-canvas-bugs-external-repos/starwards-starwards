import { DesignState, SystemState, defectible } from './system';

import { number2Digits } from '../number-field';
import { range } from '../range';
import { tweakable } from '../tweakable';
import { type } from '@colyseus/schema';

export type ReactorDesign = {
    energyPerSecond: number;
    maxEnergy: number;
    energyHeatEPMThreshold: number;
    energyHeat: number;
    damage50: number;
};

export class ReactorDesignState extends DesignState implements ReactorDesign {
    @number2Digits energyPerSecond = 0;
    @number2Digits maxEnergy = 0;
    @number2Digits energyHeatEPMThreshold = 0;
    @number2Digits energyHeat = 0;
    @number2Digits damage50 = 0;
}

export class Reactor extends SystemState {
    public static isInstance = (o: unknown): o is Reactor => {
        return (o as Reactor)?.type === 'Reactor';
    };

    public readonly type = 'Reactor';
    public readonly name = 'Reactor';

    @type(ReactorDesignState)
    design = new ReactorDesignState();

    @type('number')
    @range((t: Reactor) => [0, t.design.maxEnergy])
    @tweakable('number')
    energy = 1000;

    @number2Digits
    @range([0, 1])
    @defectible({ normal: 1, name: 'effeciency' })
    effeciencyFactor = 1;

    get energyPerSecond(): number {
        return this.effeciencyFactor * this.design.energyPerSecond;
    }

    get broken() {
        return this.effeciencyFactor === 0;
    }
}
