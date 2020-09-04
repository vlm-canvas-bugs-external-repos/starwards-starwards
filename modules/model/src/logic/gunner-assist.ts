import { ShipState } from '../ship';
import { SpaceObject, XY } from '../space';

export function getKillZoneRadius(ship: ShipState): [number, number] {
    const shellExplosionDistance = ship.chainGun.shellSecondsToLive * ship.chainGun.bulletSpeed;
    const explosionRadius = ship.chainGun.explosionSecondsToLive * ship.chainGun.explosionExpansionSpeed;
    return [shellExplosionDistance - 3.0 * explosionRadius, shellExplosionDistance + 3.0 * explosionRadius];
}

export function isTargetInKillZone(ship: ShipState, target: SpaceObject) {
    const shellHitLocation = getShellExplosionLocation(ship);
    const targetLocationAtShellExplosion = getTargetLocationAtShellExplosion(ship, target);
    const shellDangerZoneRadius = getShellDangerZoneRadius(ship);
    const aimingDistanceToTarget = XY.lengthOf(XY.difference(shellHitLocation, targetLocationAtShellExplosion));
    return aimingDistanceToTarget < shellDangerZoneRadius;
}

export function getShellSecondsToLive(ship: ShipState, targetPos: XY) {
    const distance = XY.lengthOf(XY.difference(targetPos, ship.position));
    return distance / ship.chainGun.constants.bulletSpeed;
}

export function getShellExplosionLocation(ship: ShipState): XY {
    const fireAngle = ship.angle + ship.chainGun.angle;
    const fireSource = XY.add(ship.position, XY.rotate({ x: ship.radius, y: 0 }, fireAngle));
    const fireVelocity = XY.rotate({ x: ship.chainGun.bulletSpeed, y: 0 }, fireAngle);
    const fireTime = ship.chainGun.shellSecondsToLive;
    return XY.add(fireSource, XY.scale(fireVelocity, fireTime));
}

export function getShellDangerZoneRadius(ship: ShipState): number {
    const explosionRadius = ship.chainGun.explosionSecondsToLive * ship.chainGun.explosionExpansionSpeed;
    const shellExplosionDistance = ship.chainGun.shellSecondsToLive * ship.chainGun.bulletSpeed;
    const spreadDegrees = 3.0 * ship.chainGun.bulletDegreesDeviation;
    const spread = Math.sin(spreadDegrees) * shellExplosionDistance;
    return spread + explosionRadius;
}

export function getTargetLocationAtShellExplosion(ship: ShipState, target: SpaceObject) {
    const fireTime = ship.chainGun.shellSecondsToLive;
    return XY.add(target.position, XY.scale(XY.difference(target.velocity, ship.velocity), fireTime));
}
