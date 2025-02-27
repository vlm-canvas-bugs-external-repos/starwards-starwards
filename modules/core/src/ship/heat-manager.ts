import { IterationData, Updateable } from '../updateable';

import { DamageManager } from './damage-manager';
import { ShipState } from './ship-state';
import { ShipSystem } from './ship-manager-abstract';

export const MAX_SYSTEM_HEAT = 100;
export class HeatManager implements Updateable {
    constructor(
        private state: ShipState,
        private damageManager: DamageManager,
    ) {}

    addHeat(value: number, system: ShipSystem) {
        system.heat = system.heat + value;
        if (system.heat > MAX_SYSTEM_HEAT) {
            const damageAmount = (system.heat - MAX_SYSTEM_HEAT) * 1;
            system.heat = MAX_SYSTEM_HEAT;
            this.damageManager.damageSystem(system, { id: 'overheat', amount: damageAmount }, 1);
        }
    }
    reduceHeat(value: number, system: ShipSystem) {
        const heat = system.heat;
        if (heat > 0) {
            const newHeat = heat - value;
            if (newHeat < 0) {
                system.heat = 0;
            } else {
                system.heat = heat - value;
            }
        }
    }

    update({ deltaSeconds }: IterationData) {
        const totalCoolant = this.state.design.totalCoolant; // each coolant removes 1 heat per second
        const totalCoolantFactors = this.state
            .systems()
            .map((s) => s.coolantFactor)
            .reduce((acc, curr) => acc + curr, 0);
        if (totalCoolantFactors === 0) {
            // even destibution for all systems
            const coolantPerSystem = totalCoolant / this.state.systems().length;
            for (const system of this.state.systems()) {
                this.reduceHeat(coolantPerSystem * deltaSeconds, system);
            }
        } else {
            const coolantPerFactor = totalCoolant / totalCoolantFactors;
            for (const system of this.state.systems()) {
                this.reduceHeat(system.coolantFactor * coolantPerFactor * deltaSeconds, system);
            }
        }
    }
}
