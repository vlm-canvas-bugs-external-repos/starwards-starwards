// https://stackoverflow.com/a/59459000/11813
export const getKeys = Object.keys as <T extends object>(obj: T) => Array<keyof T>;
interface EventEmitter<T extends string> {
    on(eventName: T, fn: () => unknown): unknown;
    off(eventName: T, fn: () => unknown): unknown;
}

export type Destructor = () => unknown;
export class Destructors {
    private _destroyed = false;
    private destructors = new Set<Destructor>();

    get destroyed() {
        return this._destroyed;
    }

    add = (d: Destructor) => {
        if (this._destroyed) {
            throw new Error('ading destructor to destroyed state');
        } else {
            this.destructors.add(d);
        }
    };

    child = () => {
        const child = new Destructors();
        this.add(child.destroy);
        return child;
    };

    onEvent = <T extends string>(eventEmitter: EventEmitter<T>, eventName: T, fn: () => unknown) => {
        eventEmitter.on(eventName, fn);
        this.add(() => eventEmitter.off(eventName, fn));
    };

    /**
     * cleans up and invalidates state
     */
    destroy = () => {
        if (!this._destroyed) {
            this.cleanup();
            this._destroyed = true;
        }
    };

    /**
     * cleans up and keep state valid. cleans up and invalidates children.
     */
    cleanup = () => {
        for (const destructor of this.destructors) {
            destructor();
        }
        this.destructors.clear();
    };
}

export async function waitFor<T>(body: () => T | Promise<T>, timeout: number, interval = 20): Promise<T> {
    let error: unknown = new Error('timeout is not a positive number');
    while (timeout > 0) {
        const startTime = Date.now();
        try {
            return await body();
        } catch (e) {
            error = e;
        }
        await new Promise<void>((res) => void setTimeout(res, interval));
        timeout -= Date.now() - startTime;
    }
    throw error;
}

export function printError(err: unknown): string {
    if (err instanceof Error && err.stack) {
        if (err.cause) {
            return `${err.stack}\n  [cause]: ${printError(err.cause)})`;
        }
        return err.stack;
    } else {
        return String(err);
    }
}

export function notNull<T>(e: T): e is Exclude<T, null> {
    return e !== null;
}

export function assertUnreachable(_: never): never {
    throw new Error('Should never get here');
}
