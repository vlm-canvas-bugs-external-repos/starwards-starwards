import {
    Asteroid,
    compareSpaceObjects,
    SpaceObject,
    SpaceObjectBase,
    Spaceship,
    SpaceState,
    Vec2,
} from '@starwards/model';
import { expect } from 'chai';
import 'mocha';
import { nanoid } from 'nanoid';

const fieldSize = 80000;
const map = Array(100)
    .fill(null)
    .map<SpaceObject>(() =>
        new Asteroid().init(
            nanoid(),
            new Vec2(Math.random() * fieldSize - fieldSize / 2, Math.random() * fieldSize - fieldSize / 2)
        )
    );
map.push(new Spaceship().init(nanoid(), new Vec2(0, 0)));

describe('model', () => {
    describe('SpaceState', () => {
        it('iterator has same number of elements', () => {
            const uut = new SpaceState(false);
            map.forEach((o) => uut.set(o));
            expect([...uut].length).to.equal(map.length);
        });
        it('iterator has the same elements', () => {
            const uut = new SpaceState(false);
            map.forEach((o) => uut.set(o));
            expect([...uut].sort(compareSpaceObjects)).to.eql(map.sort(compareSpaceObjects));
        });
    });
});
