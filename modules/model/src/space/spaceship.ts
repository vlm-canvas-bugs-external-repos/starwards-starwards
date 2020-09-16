import { type } from '@colyseus/schema';
import { SpaceObjectBase } from './space-object-base';

export class Spaceship extends SpaceObjectBase {
    public static isInstance(o: unknown): o is Spaceship {
        return !!o && (o as SpaceObjectBase).type === 'Spaceship';
    }

    public readonly type = 'Spaceship';

    @type('string')
    public targetId: string | null = null;

    constructor() {
        super();
        this.health = 1000;
        this.radius = 50;
    }
}
