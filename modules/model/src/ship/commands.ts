export interface ShipCommands {
    setTargetTurnSpeed: {
        value: number;
    };
    setImpulse: {
        value: number;
    };
    setAntiDrift: {
        value: number;
    };
    setStrafe: {
        value: number;
    };
    setBoost: {
        value: number;
    };
    autoCannon: {
        isFiring: boolean;
    };
    // changes to ship
    setConstant: {
        name: string;
        value: number;
    };
}

export type ShipCommand = ShipCommands[keyof ShipCommands];
