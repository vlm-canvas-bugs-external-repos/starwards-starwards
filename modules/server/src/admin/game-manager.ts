import { MapSchema } from '@colyseus/schema';
import { AdminState } from '@starwards/model';
import { matchMaker } from 'colyseus';
import { ShipManager } from '../ship/ship-manager';
import { SpaceManager } from '../space/space-manager';
import { newAsteroid, newShip, resetShip } from './map';

export class GameManager {
    public adminState = new AdminState();
    private ships = new Map<string, ShipManager>();
    private spaceManager = new SpaceManager();

    constructor() {
        this.adminState.points = new MapSchema();
    }

    public async stopGame() {
        if (this.adminState.isGameRunning) {
            const shipRooms = await matchMaker.query({ name: 'ship' });
            for (const shipRoom of shipRooms) {
                await matchMaker.remoteRoomCall(shipRoom.roomId, 'disconnect', []);
            }
            const spaceRooms = await matchMaker.query({ name: 'space' });
            for (const spaceRoom of spaceRooms) {
                await matchMaker.remoteRoomCall(spaceRoom.roomId, 'disconnect', []);
            }
            this.adminState.isGameRunning = false;
        }
    }

    public async startGame() {
        if (!this.adminState.isGameRunning) {
            this.adminState.isGameRunning = true;
            this.spaceManager = new SpaceManager();
            this.addShip(this.spaceManager, 'A');
            this.addShip(this.spaceManager, 'B');
            for (let i = 0; i < 1; i++) {
                this.spaceManager.insert(newAsteroid());
            }
            await matchMaker.createRoom('space', { manager: this.spaceManager });
        }
    }

    private addShip(spaceManager: SpaceManager, id: string) {
        const ship = newShip(id);
        this.adminState.points.set(ship.id, 0);
        const shipManager = new ShipManager(ship, spaceManager, this.ships, () => {
            this.adminState.points.set(ship.id, this.adminState.points.get(ship.id) + 1);
            resetShip(ship);
        }); // create a manager to manage the ship
        this.ships.set(id, shipManager);
        matchMaker.createRoom('ship', { manager: shipManager });
        spaceManager.insert(ship);
    }
}
