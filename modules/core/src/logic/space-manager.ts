import { Asteroid, Faction, Spaceship, Waypoint } from '../space';
import { Body, Circle, System } from 'detect-collisions';
import { Explosion, Projectile, SpaceObject, SpaceState, Vec2, XY } from '../';
import {
    FieldOfView,
    circlesIntersection,
    limitPercision,
    moveToTarget,
    rotateToTarget,
    toDegreesDelta,
    toPositiveDegreesDelta,
} from '.';
import { IterationData, Updateable } from '../updateable';
import { makeId, uniqueId } from '../id';

import { SWResponse } from './collisions-utils';

const GC_TIMEOUT = 5;
const ZERO_VELOCITY_THRESHOLD = 0;

export type Damage = {
    id: string;
    amount: number;
    damageSurfaceArc: [number, number];
    damageDurationSeconds: number;
};

type NoOrder = {
    type: 'none';
};
type MoveOrder = {
    type: 'move';
    position: XY;
};
type AttackOrder = {
    type: 'attack';
    targetId: string;
};
type FollowOrder = {
    type: 'follow';
    targetId: string;
};
type ExtraData = {
    body: Circle;
    fov: FieldOfView;
};
export type BotOrder = NoOrder | MoveOrder | AttackOrder | FollowOrder;
const nullPtr = [] as readonly [];
export type SpatialIndex = {
    selectPotentials(area: Body): Iterable<SpaceObject>;
};

export class SpaceManager implements Updateable {
    static destroyObject(state: SpaceState, id: string) {
        const subject = state.get(id);
        if (subject && !subject.destroyed && subject.expendable) {
            if (Spaceship.isInstance(subject)) {
                state.destroySpaceshipCommands.push(id);
            }
            subject.destroyed = true;
        }
    }

    public state = new SpaceState(false); // this state tree should only be exposed by the space room
    public collisions = new System();
    private collisionToState = new WeakMap<Body, SpaceObject>();
    private stateToExtraData = new WeakMap<SpaceObject, ExtraData>();
    private attachments = new Map<string, string>();
    private attachmentCliques = new Map<string, Set<SpaceObject>>();
    private objectDamage = new Map<string, Damage[]>();
    private objectOrder = new Map<string, BotOrder>();
    private toInsert: SpaceObject[] = [];

    private cleanupBodies: Body[] = [];
    private toUpdateCollisions = new Set<SpaceObject>();
    private secondsSinceLastGC = 0;

    public spatialIndex = ((mgr: SpaceManager) => ({
        *selectPotentials(area: Body): Iterable<SpaceObject> {
            mgr.collisions.insert(area);
            mgr.cleanupBodies.push(area);
            for (const potential of mgr.collisions.getPotentials(area)) {
                const object = mgr.collisionToState.get(potential);
                if (object && !object.destroyed) {
                    yield object;
                }
            }
        },
        *queryArea(area: Body): Iterable<SpaceObject> {
            mgr.collisions.insert(area);
            mgr.cleanupBodies.push(area);
            for (const potential of mgr.collisions.getPotentials(area)) {
                const object = mgr.collisionToState.get(potential);
                if (object && !object.destroyed && mgr.collisions.checkCollision(area, potential)) {
                    yield object;
                }
            }
        },
    }))(this);

    public changeTurnSpeed(id: string, delta: number) {
        const [subject] = this.getObjectPtr(id);
        if (subject) {
            subject.turnSpeed += delta;
        }
    }
    public changeVelocity(id: string, delta: XY) {
        const [subject] = this.getObjectPtr(id);
        if (subject) {
            subject.velocity.x += delta.x;
            subject.velocity.y += delta.y;
        }
    }
    public setVelocity(id: string, velocity: XY) {
        if (isNaN(velocity.x) || isNaN(velocity.y)) {
            // eslint-disable-next-line no-console
            console.warn(`trying to set "NaN" in velocity of ${id}`);
            return;
        }
        const [subject] = this.getObjectPtr(id);
        if (subject) {
            subject.velocity.setValue(velocity);
        }
    }

    private handleMoveCommand(ids: string[], delta: XY) {
        for (const subject of this.getAttachedClique(ids)) {
            Vec2.add(subject.position, delta, subject.position);
            this.toUpdateCollisions.add(subject);
        }
    }

    getObjectPtr(id: string): readonly [SpaceObject] | readonly [] {
        const o = this.state.get(id);
        return o && !o.destroyed ? [o] : nullPtr;
    }

    destroyObject(id: string) {
        SpaceManager.destroyObject(this.state, id);
    }

    private calcAttachmentCliques() {
        this.attachmentCliques.clear();
        for (const [attacherId, attacheeId] of this.attachments.entries()) {
            const clique = new Set<SpaceObject>();
            for (const obj of this.attachmentCliques.get(attacherId) || this.getObjectPtr(attacherId)) {
                clique.add(obj);
                this.attachmentCliques.set(obj.id, clique);
            }
            for (const obj of this.attachmentCliques.get(attacheeId) || this.getObjectPtr(attacheeId)) {
                clique.add(obj);
                this.attachmentCliques.set(obj.id, clique);
            }
        }
    }

    private getAttachedClique(ids: string[]) {
        const result = new Set<SpaceObject>(); // use set to not emit same object twice
        for (const id of ids) {
            for (const obj of this.attachmentCliques.get(id) || this.getObjectPtr(id)) {
                result.add(obj);
            }
        }
        return result;
    }

    // batch changes to map indexes to save i/o
    private gc() {
        this.untrackDestroyedObjects();
        this.secondsSinceLastGC = 0;
        for (const destroyed of this.state[Symbol.iterator](true)) {
            this.state.delete(destroyed);
            this.objectDamage.delete(destroyed.id);
            this.objectOrder.delete(destroyed.id);
        }
    }

    update({ deltaSeconds }: IterationData) {
        this.calcAttachmentCliques();
        for (const cmd of this.state.createAsteroidCommands) {
            const asteroid = new Asteroid().init(makeId(), Vec2.make(cmd.position), cmd.radius);
            this.insert(asteroid);
        }
        this.state.createAsteroidCommands = [];
        for (const cmd of this.state.createExplosionCommands) {
            const explosion = new Explosion().init(makeId(), Vec2.make(cmd.position), cmd.damageFactor);
            this.insert(explosion);
        }
        this.state.createExplosionCommands = [];
        for (const cmd of this.state.createWaypointCommands) {
            const waypoint = new Waypoint().init(makeId(), Vec2.make(cmd.position));
            this.insert(waypoint);
        }
        this.state.createWaypointCommands = [];
        this.handleToInsert();
        for (const moveCommand of this.state.moveCommands) {
            this.handleMoveCommand(moveCommand.ids, moveCommand.delta);
        }
        this.state.moveCommands = [];

        for (const cmd of this.state.botOrderCommands) {
            for (const id of cmd.ids) {
                const [subject] = this.getObjectPtr(id);
                if (subject && Spaceship.isInstance(subject)) {
                    this.objectOrder.set(id, cmd.order);
                }
            }
        }
        this.state.botOrderCommands = [];

        this.growExplosions(deltaSeconds);
        this.destroyTimedOut(deltaSeconds);
        this.calcHomingProjectiles(deltaSeconds);
        this.untrackDestroyedObjects();
        this.frozendAndAttachedDontMove();
        this.applyPhysics(deltaSeconds);
        this.updateFieldsOFView();
        this.updateCollisionBodies();
        this.handleCollisions(deltaSeconds);
        this.secondsSinceLastGC += deltaSeconds;
        if (this.secondsSinceLastGC > GC_TIMEOUT) {
            this.gc();
        }
    }

    public getFactionVisibleObjects(faction: Faction) {
        const visibleObjects = new Set<SpaceObject>();
        for (const object of this.state) {
            if (object.faction === faction) {
                visibleObjects.add(object);
                const data = this.stateToExtraData.get(object);
                if (data) {
                    for (const visibleArc of data.fov.view) {
                        visibleArc.object && visibleObjects.add(visibleArc.object);
                    }
                } else {
                    // eslint-disable-next-line no-console
                    console.error(`object leak! ${object.id} has no extra data`);
                }
            }
        }
        return visibleObjects;
    }

    private growExplosions(deltaSeconds: number) {
        for (const explosion of this.state.getAll('Explosion')) {
            if (!explosion.freeze) {
                explosion.radius += explosion.expansionSpeed * deltaSeconds;
                this.toUpdateCollisions.add(explosion);
            }
        }
    }

    private destroyTimedOut(deltaSeconds: number) {
        for (const explosion of this.state.getAll('Explosion')) {
            if (!explosion.freeze) {
                explosion.secondsToLive -= deltaSeconds;
                if (explosion.secondsToLive <= 0) {
                    explosion.destroyed = true;
                }
            }
        }
        for (const shell of this.state.getAll('Projectile')) {
            if (!shell.freeze) {
                shell.secondsToLive -= deltaSeconds;
                if (shell.secondsToLive <= 0) {
                    this.explodeProjectile(shell);
                }
            }
        }
    }

    private calcHomingProjectiles(deltaSeconds: number) {
        for (const projectile of this.state.getAll('Projectile')) {
            if (!projectile.freeze && projectile.design.homing && projectile.targetId) {
                const [target] = this.getObjectPtr(projectile.targetId);
                if (target) {
                    const destination = target.position;
                    const relativeDestination = XY.difference(destination, projectile.position);
                    if (
                        XY.lengthOf(relativeDestination) - target.radius <
                        projectile.design.homing.proximityDetonation
                    ) {
                        this.explodeProjectile(projectile);
                    } else {
                        const velocityDestinationDiff = toDegreesDelta(
                            XY.angleOf(relativeDestination) - XY.angleOf(projectile.velocity),
                        );

                        let rotation = 0;
                        let boost = 0;
                        if (Math.abs(velocityDestinationDiff) > 45 && Math.abs(velocityDestinationDiff) < 135) {
                            // velocity is sideways from angle, make a sharp turn againt it
                            rotation = rotateToTarget(
                                deltaSeconds,
                                projectile,
                                XY.add(projectile.position, XY.scale(projectile.velocity, -10)),
                                0,
                            );
                            boost = 1;
                        } else {
                            rotation = rotateToTarget(deltaSeconds, projectile, destination, 0);
                            boost = moveToTarget(deltaSeconds, projectile, destination).boost;
                        }

                        projectile.turnSpeed += rotation * deltaSeconds * projectile.rotationCapacity;
                        if (boost > 0) {
                            const desiredSpeed = XY.scale(
                                XY.rotate(XY.one, projectile.angle),
                                boost * deltaSeconds * projectile.design.homing.velocityCapacity,
                            );
                            projectile.velocity.add(desiredSpeed);
                        }
                        if (XY.lengthOf(projectile.velocity) > projectile.design.homing.maxSpeed) {
                            projectile.velocity.normalize(projectile.design.homing.maxSpeed);
                        }
                    }
                }
            }
        }
    }

    private untrackDestroyedObjects() {
        for (const destroyed of this.state[Symbol.iterator](true)) {
            const data = this.stateToExtraData.get(destroyed);
            if (data) {
                this.stateToExtraData.delete(destroyed);
                this.collisionToState.delete(data.body);
                this.collisions.remove(data.body);
                this.attachments.delete(destroyed.id);
            }
        }
        for (const body of this.cleanupBodies) {
            this.collisions.remove(body);
        }
        this.cleanupBodies.length = 0;
    }

    public checkDuplicateShip(shipId: string) {
        return this.state.getShip(shipId) || this.toInsert.find(({ id }) => id === shipId);
    }

    public insert(object: SpaceObject) {
        this.toInsert.push(object);
    }

    public insertBulk(objects: Iterable<SpaceObject>) {
        this.toInsert.push(...objects);
    }

    public forceFlushEntities() {
        this.handleToInsert();
    }

    public attach(attacherId: string, attacheeId: string) {
        this.attachments.set(attacherId, attacheeId);
    }

    public detach(attacherId: string) {
        const clique = this.attachmentCliques.get(attacherId);
        if (clique) {
            const [subject] = this.getObjectPtr(attacherId);
            if (subject) {
                let velocity = XY.zero;
                let turnSpeed = 0;
                for (const obj of clique) {
                    velocity = XY.add(velocity, obj.velocity);
                    turnSpeed += obj.turnSpeed;
                }
                subject.velocity.setValue(velocity);
                subject.turnSpeed = toDegreesDelta(turnSpeed);
            }
        }
        this.attachments.delete(attacherId);
    }

    private handleToInsert() {
        if (this.toInsert.length) {
            this.gc();
            for (const object of this.toInsert) {
                this.state.set(object);
                const body = this.collisions.createCircle(XY.clone(object.position), object.radius);
                this.collisionToState.set(body, object);
                const fov = new FieldOfView(this.spatialIndex, object);
                this.stateToExtraData.set(object, { body, fov });
            }
            this.toInsert = [];
        }
    }

    private frozendAndAttachedDontMove() {
        for (const object of this.state) {
            if (object.freeze || this.attachments.get(object.id)) {
                object.velocity.x = object.velocity.y = object.turnSpeed = 0;
            }
        }
    }

    private allowRaycastCollision = (potential: Body) => {
        const object = this.collisionToState.get(potential as Circle);
        const ignore = !object || this.isProjectile(object);
        return !ignore;
    };

    private applyPhysics(deltaSeconds: number) {
        // loop over objects and apply velocity
        for (const subject of this.state) {
            if (!XY.isZero(subject.velocity, ZERO_VELOCITY_THRESHOLD)) {
                const positionDelta = XY.scale(subject.velocity, deltaSeconds);
                for (const obj of this.attachmentCliques.get(subject.id) || [subject]) {
                    let destination = XY.add(obj.position, positionDelta);
                    if (this.isProjectile(obj)) {
                        const res = this.collisions.raycast(obj.position, destination, this.allowRaycastCollision);
                        if (res) {
                            destination = res.point;
                        }
                    }
                    obj.position.setValue(destination);
                    this.toUpdateCollisions.add(obj);
                }
            }
            if (subject.turnSpeed) {
                const angleDelta = subject.turnSpeed * deltaSeconds;
                for (const obj of this.attachmentCliques.get(subject.id) || [subject]) {
                    obj.angle = toPositiveDegreesDelta(obj.angle + angleDelta);
                    if (subject !== obj) {
                        const destination = XY.add(
                            XY.rotate(XY.difference(obj.position, subject.position), angleDelta),
                            subject.position,
                        );
                        obj.position.setValue(destination);
                        this.toUpdateCollisions.add(obj);
                    }
                }
            }
        }
    }

    private explodeProjectile(projectile: Projectile) {
        projectile.destroyed = true;
        const explosion = projectile._explosion || new Explosion();
        explosion.init(uniqueId('explosion'), projectile.position.clone(), explosion.damageFactor);
        explosion.velocity = projectile.velocity.clone();
        this.insert(explosion);
    }

    public *resolveObjectDamage(id: string): IterableIterator<Damage> {
        const damageArr = this.objectDamage.get(id);
        if (damageArr !== undefined) {
            yield* damageArr;
            this.objectDamage.delete(id);
        }
    }

    public changeShipRadarRange(id: string, radarRange: number) {
        const ship = this.state.getShip(id);
        if (ship && !ship.destroyed) {
            ship.radarRange = radarRange;
        }
    }

    public resolveObjectOrder(id: string) {
        const order = this.objectOrder.get(id);
        this.objectOrder.delete(id);
        return order || null;
    }

    private isProjectile = (o: SpaceObject) =>
        Projectile.isInstance(o) || (Explosion.isInstance(o) && XY.isZero(o.velocity, o.radius));

    private handleCollisions(deltaSeconds: number) {
        const positionChanges: Array<{ s: SpaceObject; p: XY }> = [];
        // find and handle collisions
        this.collisions.checkAll((response: SWResponse) => {
            const subject = this.collisionToState.get(response.a);
            const object = this.collisionToState.get(response.b);
            if (
                subject &&
                !subject.destroyed &&
                !subject.freeze &&
                object &&
                !Projectile.isInstance(object) &&
                !Waypoint.isInstance(subject) &&
                !Waypoint.isInstance(object) &&
                !object.destroyed
            ) {
                let positionChange: XY | null = null;
                if (Projectile.isInstance(subject)) {
                    this.explodeProjectile(subject);
                } else if (Explosion.isInstance(subject)) {
                    positionChange = this.handleExplosionCollision(subject, response);
                } else {
                    const res = this.calcSolidCollision(deltaSeconds, subject, object, response);
                    positionChange = res.positionChange;
                    Vec2.add(subject.velocity, res.velocityChange, subject.velocity);
                    if (Spaceship.isInstance(subject)) {
                        this.handleShipCollisionDamage(deltaSeconds, res.damageAmount, subject, object, response);
                    } else {
                        subject.health -= res.damageAmount;
                    }
                }
                if (positionChange) {
                    positionChanges.push({ s: subject, p: positionChange });
                }
            }
        });
        for (const { s, p } of positionChanges) {
            for (const obj of this.attachmentCliques.get(s.id) || [s]) {
                Vec2.add(obj.position, p, obj.position);
                this.toUpdateCollisions.add(obj);
            }
        }
    }
    private handleExplosionCollision(subject: Explosion, response: SWResponse) {
        let positionChange: XY | null = null;
        if (response.aInB) {
            subject.velocity.setValue(XY.zero);
            positionChange = XY.scale(response.overlapV, -0.5);
        } else if (limitPercision(response.overlap) > limitPercision(subject.radius)) {
            positionChange = XY.scale(response.overlapN, -subject.radius);
        }
        return positionChange;
    }

    private calcSolidCollision(
        deltaSeconds: number,
        subject: Exclude<SpaceObject, Projectile | Explosion>,
        object: SpaceObject,
        response: SWResponse,
    ) {
        if (Explosion.isInstance(object)) {
            const exposure = deltaSeconds * Math.min(response.overlap, object.radius * 2);
            return {
                damageAmount: object.damageFactor * deltaSeconds * Math.min(response.overlap, object.radius * 2),
                positionChange: null,
                velocityChange: XY.scale(response.overlapV, -exposure * object.blastFactor),
            };
        } else {
            const collisionVector = XY.scale(response.overlapV, -0.5);
            return {
                damageAmount: subject.collisionDamage * Math.min(response.overlap, object.radius * 2),
                positionChange: collisionVector,
                velocityChange: XY.scale(collisionVector, subject.collisionElasticity / deltaSeconds),
            };
        }
    }

    private handleShipCollisionDamage(
        deltaSeconds: number,
        damageAmount: number,
        subject: Spaceship,
        object: SpaceObject,
        response: SWResponse,
    ) {
        const damageBoundries = circlesIntersection(subject, object);
        if (damageBoundries) {
            const shipLocalDamageBoundries: [XY, XY] = [
                subject.globalToLocal(XY.difference(damageBoundries[0], subject.position)),
                subject.globalToLocal(XY.difference(damageBoundries[1], subject.position)),
            ];
            const shipLocalDamageAngles: [number, number] = [
                limitPercision(XY.angleOf(shipLocalDamageBoundries[0])),
                limitPercision(XY.angleOf(shipLocalDamageBoundries[1])),
            ];
            const damage = {
                id: object.id,
                amount: damageAmount,
                damageSurfaceArc: shipLocalDamageAngles,
                damageDurationSeconds: deltaSeconds,
            };
            const objectDamage = this.objectDamage.get(subject.id);
            if (objectDamage === undefined) {
                this.objectDamage.set(subject.id, [damage]);
            } else {
                objectDamage.push(damage);
            }
        } else {
            // eslint-disable-next-line no-console
            console.error(
                `unexpected undefined intersection with Spaceship.\n${collisionErrorMsg(object, subject, response)}`,
            );
        }
    }

    private updateFieldsOFView() {
        for (const object of this.state) {
            const data = this.stateToExtraData.get(object);
            if (data) {
                data.fov.setDirty();
            } else {
                // eslint-disable-next-line no-console
                console.error(`object leak! ${object.id} has no extra data`);
            }
        }
    }

    private updateCollisionBodies() {
        for (const object of this.toUpdateCollisions) {
            if (!object.destroyed) {
                const data = this.stateToExtraData.get(object);
                if (data) {
                    data.body.r = object.radius;
                    data.body.setPosition(object.position.x, object.position.y); // order matters! setPosition() internally calls updateAABB()
                } else {
                    // eslint-disable-next-line no-console
                    console.error(`object leak! ${object.id} has no extra data`);
                }
            }
        }
        this.collisions.update();
        // reset toUpdateCollisions
        this.toUpdateCollisions.clear();
    }
}

function collisionErrorMsg(object: SpaceObject, subject: SpaceObject, response: SWResponse) {
    return `Subject ${subject.type} data: centre: ${JSON.stringify(subject.position)}(${JSON.stringify(
        response.a.pos,
    )}) radius: ${JSON.stringify(subject.radius)}\n Object ${object.type} data: centre: ${JSON.stringify(
        object.position,
    )}(${JSON.stringify(response.b.pos)}) radius: ${JSON.stringify(object.radius)}. state distance: ${XY.lengthOf(
        XY.difference(subject.position, object.position),
    )}. collision distance: ${XY.lengthOf(XY.difference(response.a.pos, response.b.pos))}`;
}
