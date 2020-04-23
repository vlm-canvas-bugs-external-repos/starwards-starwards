import { AdminState, AdminCommand, isAdminCommand } from '@starwards/model';
import { Client, matchMaker, Room } from 'colyseus';

export class AdminRoom extends Room<AdminState> {
    constructor() {
        super();
        this.autoDispose = false;
    }

    public async onLeave(client: Client, consented: boolean) {
        if (!consented) {
            await this.allowReconnection(client, 30);
        }
    }

    public onCreate() {
        this.setState(new AdminState());
    }

    public async onMessage(_client: Client, message: AdminCommand) {
        if (isAdminCommand('StartGame', message)) {
            await matchMaker.createRoom('space', {}); // create a game
        }
    }
}
