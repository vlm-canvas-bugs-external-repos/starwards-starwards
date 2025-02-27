import { IterationData, Updateable } from '../updateable';
import { Projectile, SpaceObject, Spaceship, projectileModels } from '../space';
import { SpaceManager, XY, calcShellSecondsToLive, capToRange, lerp } from '../logic';
import { Vec2, gaussianRandom } from '..';

import { ChainGun } from './chain-gun';
import { DeepReadonly } from 'ts-essentials';
import { EPSILON } from '../logic';
import { EnergySource } from './ship-manager-abstract';
import { Iterator } from '../logic/iteration';
import { Magazine } from './magazine';
import { ShipState } from './ship-state';
import { SmartPilotMode } from './smart-pilot';
import { uniqueId } from '../id';

export function resetChainGun(chainGun: ChainGun) {
    chainGun.angleOffset = 0;
    chainGun.rateOfFireFactor = 1;
    chainGun.shellRangeMode = SmartPilotMode.DIRECT;
}

type ShipManager = {
    readonly weaponsTarget: SpaceObject | null;
};

export function switchToAvailableAmmo(chainGun: ChainGun, magazine: Magazine) {
    if (chainGun.projectile === 'None') {
        chainGun.projectile = new Iterator(projectileModels)
            .filter((p) => chainGun.design[`use_${p}`] && magazine[`count_${p}`] > 0)
            .firstOr('None');
    }
}
export class ChainGunManager implements Updateable {
    /**
     * used to accuretly simulate very high rate of fire
     */
    private loadingRemainder = 0;

    constructor(
        public chainGun: ChainGun,
        public spaceObject: DeepReadonly<Spaceship>,
        public state: ShipState,
        private spaceManager: SpaceManager,
        private shipManager: ShipManager,
        private energyManager: EnergySource,
    ) {
        switchToAvailableAmmo(chainGun, state.magazine);
    }

    public setShellRangeMode(value: SmartPilotMode) {
        if (value === SmartPilotMode.TARGET && !this.shipManager.weaponsTarget) {
            // eslint-disable-next-line no-console
            console.error(new Error(`attempt to set chainGun.shellRangeMode to TARGET with no target`));
        } else {
            if (value !== this.chainGun.shellRangeMode) {
                this.chainGun.shellRangeMode = value;
                this.chainGun.shellRange = 0;
            }
        }
    }

    update({ deltaSeconds }: IterationData) {
        this.calcShellSecondsToLive();
        this.updateChainGun(deltaSeconds);
        this.fireChainGun();
    }

    private calcShellSecondsToLive() {
        if (this.chainGun.design.overrideSecondsToLive > 0) {
            this.chainGun.shellSecondsToLive = this.chainGun.design.overrideSecondsToLive;
        } else {
            const aimRange = (this.chainGun.design.maxShellRange - this.chainGun.design.minShellRange) / 2;
            let baseRange: number | undefined = undefined;
            switch (this.chainGun.shellRangeMode) {
                case SmartPilotMode.DIRECT:
                    baseRange = this.chainGun.design.minShellRange + aimRange;
                    break;
                case SmartPilotMode.TARGET:
                    baseRange = capToRange(
                        this.chainGun.design.minShellRange,
                        this.chainGun.design.maxShellRange,
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        XY.lengthOf(XY.difference(this.shipManager.weaponsTarget!.position, this.state.position)),
                    );
                    break;
                default:
                    throw new Error(
                        `unknown state ${SmartPilotMode[this.chainGun.shellRangeMode]} (${
                            this.chainGun.shellRangeMode
                        })`,
                    );
            }
            const range = capToRange(
                this.chainGun.design.minShellRange,
                this.chainGun.design.maxShellRange,
                baseRange + lerp([-1, 1], [-aimRange, aimRange], this.chainGun.shellRange),
            );
            this.chainGun.shellSecondsToLive = calcShellSecondsToLive(this.state, this.chainGun, range);
        }
    }

    private updateChainGun(deltaSeconds: number) {
        const chainGun = this.chainGun;
        if (chainGun.projectile !== 'None' && !chainGun.design[`use_${chainGun.projectile}`]) {
            chainGun.changeProjectileCommand = true;
        }
        if (chainGun.changeProjectileCommand) {
            chainGun.changeProjectileCommand = false;
            const ammoTypes = new Iterator(projectileModels).filter((p) => chainGun.design[`use_${p}`]);
            if (chainGun.projectile === 'None') {
                chainGun.projectile = ammoTypes.firstOr('None');
            } else {
                chainGun.projectile = ammoTypes.elementAfter(chainGun.projectile);
            }
        }
        if (!chainGun.effectiveness) {
            chainGun.isFiring = false;
        }
        if (!chainGun.isFiring) {
            this.loadingRemainder = 0;
        }
        const dontLoad =
            chainGun.projectile !== 'None' &&
            chainGun.loading === 0 &&
            this.state.magazine[`count_${chainGun.projectile}`] < 1;
        const loadingDelta =
            chainGun.design.bulletsPerSecond * chainGun.rateOfFireFactor * chainGun.effectiveness * deltaSeconds;
        const loadingEnergy =
            chainGun.design.bulletsPerSecond * chainGun.effectiveness * deltaSeconds * chainGun.design.energyCost;
        if (loadingDelta > 0) {
            // const loadAction = this.calcLoadAction();
            if (
                chainGun.loadedProjectile !== 'None' &&
                (chainGun.projectile !== chainGun.loadedProjectile || !chainGun.loadAmmo)
            ) {
                // unload
                if (this.energyManager.trySpendEnergy(loadingEnergy, chainGun)) {
                    chainGun.loading -= loadingDelta;
                    if (chainGun.loading <= 0) {
                        chainGun.loading = 0;
                        this.state.magazine[`count_${chainGun.loadedProjectile}`] += 1;
                        chainGun.loadedProjectile = 'None';
                    }
                }
            } else if (chainGun.projectile !== 'None' && chainGun.loadAmmo && chainGun.loading < 1 && !dontLoad) {
                // load
                if (this.energyManager.trySpendEnergy(loadingEnergy, chainGun)) {
                    if (chainGun.loading === 0) {
                        this.state.magazine[`count_${chainGun.projectile}`] -= 1;
                        chainGun.loadedProjectile = chainGun.projectile;
                        chainGun.loading += this.loadingRemainder;
                        this.loadingRemainder = 0;
                    }
                    chainGun.loading += loadingDelta;
                    if (chainGun.loading >= 1) {
                        this.loadingRemainder = chainGun.loading - 1;
                        chainGun.loading = 1;
                    }
                }
            }
        }
    }

    private fireChainGun() {
        const chainGun = this.chainGun;
        if (
            chainGun.effectiveness > 0 &&
            chainGun.isFiring &&
            chainGun.loading >= 1 &&
            chainGun.loadedProjectile !== 'None'
        ) {
            const projectile = new Projectile(chainGun.loadedProjectile);
            chainGun.loading = 0;
            chainGun.loadedProjectile = 'None';
            projectile.angle = gaussianRandom(
                this.spaceObject.angle + chainGun.angle + chainGun.angleOffset,
                chainGun.design.bulletDegreesDeviation,
            );
            projectile.velocity = Vec2.sum(
                this.spaceObject.velocity,
                XY.rotate({ x: chainGun.design.bulletSpeed, y: 0 }, projectile.angle),
            );
            const shellPosition = Vec2.make(
                XY.sum(
                    this.spaceObject.position, // position of ship
                    XY.byLengthAndDirection(this.spaceObject.radius + projectile.radius + EPSILON, projectile.angle), // muzzle related to ship
                    XY.byLengthAndDirection(projectile.radius * 2, projectile.angle), // some initial distance
                ),
            );
            projectile.init(uniqueId('shell'), shellPosition);
            if (projectile.design.homing) {
                projectile.targetId = this.state.weaponsTarget.targetId;
                projectile.secondsToLive = projectile.design.homing.secondsToLive;
            } else {
                projectile.secondsToLive = chainGun.shellSecondsToLive;
            }
            this.spaceManager.insert(projectile);
        }
    }
}
