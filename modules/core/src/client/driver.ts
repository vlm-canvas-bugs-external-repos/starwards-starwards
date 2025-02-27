import { AdminState, EventEmitter, schemaClasses } from '..';
import { Client, Room } from 'colyseus.js';
import { ConnectionManager, ConnectionStateEvent } from './connection-manager';

import { AdminDriver } from './admin';
import { SchemaConstructor } from 'colyseus.js/lib/serializer/SchemaSerializer';
import { ShipDriver } from './ship';
import { SpaceDriver } from './space';
import { waitForEvents } from '../async-utils';

export type ShipDriverRead = Pick<ShipDriver, 'state' | 'events'>;

export function getColyseusEndpoint(location: { protocol: string; host: string }) {
    return (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/colyseus';
}
export class Driver {
    private connectionManager = new ConnectionManager(() => {
        this.adminDriver = this.joinRoom('admin', schemaClasses.admin)
            .then(this.hookAdminRoomLifecycle)
            .then(AdminDriver(this.httpEndpoint));
        return this.adminDriver;
    });
    public get connectionStatus(): EventEmitter<{ [k in ConnectionStateEvent]: void }> {
        return this.connectionManager.events;
    }
    public get isConnected() {
        return this.connectionManager.stateConnected;
    }
    public get errorMessage(): string | null {
        return this.connectionManager.getErrorMessage();
    }
    public httpEndpoint: string;
    private rooms: Client;

    private adminDriver: Promise<AdminDriver> | null = null;
    private spaceDriver: Promise<SpaceDriver> | null = null;
    private shipDrivers = new Map<string, Promise<ShipDriver>>();

    private hookRoomLifecycle = <R extends Room>(room: R) => {
        room.onError((code, message) => this.connectionManager.onConnectionError({ code, message }));
        if (this.connectionManager.isDestroyed) {
            void room.leave(true);
            throw new Error(`client destroyed while room joined`);
        }
        this.connectionManager.events.once('exit:connected', () => void room.leave(true));
        this.connectionManager.events.once('destroyed', () => void room.leave(true));
        return room;
    };

    private hookAdminRoomLifecycle = (room: Room<AdminState>) => {
        room.onLeave(() => {
            if (!this.connectionManager.isDestroyed) {
                this.connectionManager.onConnectionError(new Error(`disconnected from server`));
            }
        });
        this.connectionManager.events.once('error', () => void room.leave(true));
        return this.hookRoomLifecycle(room);
    };

    /**
     * @param location window.location compatible object
     */
    constructor(location: { protocol: string; host: string }) {
        const colyseusEndpoint = getColyseusEndpoint(location);
        this.httpEndpoint = location.protocol + '//' + location.host;
        this.rooms = new Client(colyseusEndpoint);
        this.connectionManager.events.on('exit:connected', this.clearCache);
        void this.onGameStateChange(async () => {
            if (!(await this.getGameStatus())) {
                this.spaceDriver = null;
                this.shipDrivers.clear();
            }
        });
    }

    private async joinRoom<T>(roomId: string, rootSchema: SchemaConstructor<T>): Promise<Room<T>> {
        return this.rooms.joinById(roomId, {}, rootSchema);
    }

    clearCache = () => {
        this.adminDriver = null;
        this.spaceDriver = null;
        this.shipDrivers.clear();
    };

    connect(reconnectIntervalMS = 10) {
        this.connectionManager.reconnectIntervalMS = reconnectIntervalMS;
        this.connectionManager.connect();
        return this;
    }
    destroy() {
        this.connectionManager.destroy();
    }

    private getAdminDriverWhenConnected(): Promise<AdminDriver> {
        if (!this.adminDriver) {
            throw new Error('connected, but missing adminDriver');
        }
        return this.adminDriver;
    }
    onGameStateChange(cb: () => unknown): () => void {
        const wrappedListener: () => unknown = async () => {
            try {
                if (!this.connectionManager.isDestroyed) {
                    await cb();
                }
            } catch (e) {
                void 0;
            }
        };
        let abort = false;
        let unRegister = () => undefined as unknown;
        this.connectionManager.events.on('*', wrappedListener);
        void (async () => {
            while (!abort && !this.connectionManager.isDestroyed) {
                try {
                    await this.connectionManager.waitForConnected();
                } catch (e) {
                    continue;
                }
                const driver = await this.getAdminDriverWhenConnected();
                await wrappedListener();
                driver.events.on('**', wrappedListener);
                unRegister = () => driver.events.off('**', wrappedListener);
                await waitForEvents(this.connectionManager.events, ['exit:connected']);
                unRegister();
            }
        })();
        return () => {
            abort = true;
            this.connectionManager.events.off('*', wrappedListener);
            unRegister();
        };
    }
    async getGameStatus() {
        return (await this.getAdminDriver()).state.gameStatus;
    }

    /**
     * Returns a finite iterator for the IDs of the ship currently active
     */
    async getCurrentShipIds(): Promise<Iterable<string>> {
        return (await this.getAdminDriver()).state.shipIds;
    }

    /**
     * Returns a finite iterator for the IDs of the player ship currently active
     */
    async getCurrentPlayerShipIds(): Promise<Iterable<string>> {
        return (await this.getAdminDriver()).state.playerShipIds;
    }

    async doesShipExist(shipId: string): Promise<boolean> {
        return (await this.getAdminDriver()).state.shipIds.includes(shipId);
    }

    /**
     * infinite iterator
     */
    async *getUniqueShipIds() {
        const ships = new Set<string>();
        while (!this.connectionManager.isDestroyed) {
            for (const shipId of await this.getCurrentShipIds()) {
                if (!ships.has(shipId)) {
                    ships.add(shipId);
                    yield shipId;
                }
            }
            await new Promise((res) => setTimeout(res, 500));
        }
    }

    /**
     * constantly scan for a game and return when a game is running
     */
    async waitForGame(): Promise<void> {
        while (!(await this.getGameStatus())) {
            await new Promise((res) => setTimeout(res, 500));
        }
    }
    /**
     * constantly scan for new ships and return when current ship is found
     * @param shipToWaitFor id of the ship to wait for
     */
    async waitForShip(shipToWaitFor: string): Promise<void> {
        for await (const shipId of this.getUniqueShipIds()) {
            if (shipToWaitFor === shipId) {
                return;
            }
        }
        throw new Error('client destroyed before ship appeared');
    }

    async getShipDriver(shipId: string): Promise<ShipDriver> {
        await this.connectionManager.waitForConnected();
        if (this.shipDrivers.has(shipId)) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return this.shipDrivers.get(shipId)!;
        }
        const shipDriver = this.makeShipDriver(shipId);
        this.shipDrivers.set(shipId, shipDriver);
        return shipDriver;
    }

    private async makeShipDriver(shipId: string) {
        try {
            await this.waitForShip(shipId);
            const room = await this.joinRoom(shipId, schemaClasses.ship).then(this.hookRoomLifecycle);
            return await ShipDriver(room);
        } catch (e) {
            const error = new Error('failed making ship driver', { cause: e });
            this.connectionManager.onConnectionError(error);
            throw error;
        }
    }

    async getSpaceDriver(): Promise<SpaceDriver> {
        await this.connectionManager.waitForConnected();
        if (this.spaceDriver) {
            return await this.spaceDriver;
        }
        try {
            this.spaceDriver = this.joinRoom('space', schemaClasses.space)
                .then(this.hookRoomLifecycle)
                .then(SpaceDriver);
            return await this.spaceDriver;
        } catch (e) {
            const error = new Error('failed making space driver', { cause: e });
            this.connectionManager.onConnectionError(error);
            throw error;
        }
    }

    async getAdminDriver(): Promise<AdminDriver> {
        await this.connectionManager.waitForConnected();
        return await this.getAdminDriverWhenConnected();
    }
}
