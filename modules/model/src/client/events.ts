import { Armor, ArmorPlate } from '../ship';
import { Container, Event, Replace, Visitor, coreVisitors, customWireEvents, handleMapSchema } from 'colyseus-events';
import { SpaceState, Vec2 } from '../space';

import { ArraySchema } from '@colyseus/schema';
import { ModelParams } from '../model-params';

const visitSpaceState: Visitor = {
    visit: (traverse, state, events, jsonPath) => {
        if (!(state instanceof SpaceState)) {
            return false;
        }
        // in addition to emitting events under the original name (the pointer) also emit them under '$' + op name ('/$add' etc.)
        const eventsWrapper = {
            emit(eventName: string, event: Event) {
                events.emit(eventName, event);
                if (event.path.lastIndexOf('/') === jsonPath.length) {
                    // current level event (not deep)
                    const opEventName = `${jsonPath}/$${event.op}`;
                    events.emit(opEventName, event);
                }
            },
        };
        state.onChange = () => {
            throw new Error('BUG: Cant handle events when replacing root map of SpaceState');
        };
        // treat SpaceState as one big map - wire all its maps as if they are the same object (same json path)
        for (const map of state.maps()) {
            handleMapSchema.visit(traverse, map, eventsWrapper, jsonPath);
        }
        return true;
    },
};
const visitVec2: Visitor = {
    visit: (_, state, events, jsonPath) => {
        if (!(state instanceof Vec2)) {
            return false;
        }
        // treat Vec2 as a primitive- any change is wired as a change to the entire object
        state.onChange = () => {
            events.emit(jsonPath, Replace(jsonPath, state));
        };
        return true;
    },
};

const visitModelParams: Visitor = {
    visit: (_, state, events, jsonPath) => {
        if (!(state instanceof ModelParams)) {
            return false;
        }
        // treat ModelParams as a primitive- any change is wired as a change to the entire object
        const wireValues = () => {
            if (state.params) {
                state.params.onAdd =
                    state.params.onRemove =
                    state.params.onChange =
                        () => events.emit(jsonPath, Replace(jsonPath, state));
            }
        };
        state.onChange = () => {
            events.emit(jsonPath, Replace(jsonPath, state));
            wireValues();
        };
        wireValues();
        return true;
    },
};

function isArmorPlates(state: Container, namespace: string): state is ArraySchema<ArmorPlate> {
    return (
        state instanceof ArraySchema &&
        state['$changes'].parent instanceof Armor &&
        namespace.split('/').pop() === 'armorPlates'
    );
}

const visitArmorPlates: Visitor = {
    visit: (_, state, events, namespace) => {
        if (!isArmorPlates(state, namespace)) {
            return false;
        }
        // treat the armorPlates colleaction as a primitive- any change is wired as a change to the entire collection
        const emitChanged = () => events.emit(namespace, Replace(namespace, state));
        state.onChange = state.onAdd = (value) => {
            emitChanged();
            value.onChange = emitChanged;
        };
        state.onRemove = emitChanged;
        for (const value of state.values()) {
            value.onChange = emitChanged;
        }
        return true;
    },
};
const customVisitors = [visitArmorPlates, visitSpaceState, visitVec2, visitModelParams, ...coreVisitors];

export const wireEvents = customWireEvents(customVisitors);
