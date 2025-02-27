import {
    BladeApi,
    FolderApi,
    InputParams,
    ListApi,
    ListBladeParams,
    SliderApi,
    SliderBladeParams,
    TextApi,
    TextBladeParams,
} from 'tweakpane';
import { BladeController, ButtonParams, NumberMonitorParams, View } from '@tweakpane/core';
import { Destructor, RTuple2 } from '@starwards/core';

import { RingInputParams } from '@tweakpane/plugin-camerakit/dist/types/util';

export type NumericModel = {
    getValue: () => number | undefined;
    setValue?: (v: number) => unknown;
    onChange: (cb: () => unknown) => Destructor;
    range: RTuple2;
};

export type Model<T> = {
    getValue: () => T | undefined;
    setValue?: (v: T) => unknown;
    onChange: (cb: () => unknown) => Destructor;
};
/*
    This module was written after ./property-panel
    This is the module to use to creatte new panels
*/

export function configSliderBlade(
    params: Partial<SliderBladeParams>,
    range: RTuple2,
    getValue: () => number | undefined,
) {
    return {
        parse: (v: number) => String(v),
        ...params,
        view: 'slider',
        min: range[0],
        max: range[1],
        value: getValue(),
    };
}

export function configTextBlade(params: Partial<TextBladeParams<unknown>> = {}, getValue: () => unknown = () => '') {
    return {
        parse: (v: unknown) => String(v),
        ...params,
        view: 'text',
        value: getValue(),
    };
}

export function configListBlade<T>(params: Partial<ListBladeParams<T>>, getValue: () => T | undefined) {
    return {
        options: [],
        ...params,
        view: 'list',
        value: getValue(),
    };
}

export type BladeGuiApi<T> = {
    value: T;
    on(eventName: 'change', handler: (ev: { value: T }) => void): unknown;
} & BladeApi<BladeController<View>>;

export function wireBlade<T>(
    blade: BladeGuiApi<T>,
    { getValue, onChange, setValue }: Model<T>,
    cleanup: (d: Destructor) => void,
) {
    const v = getValue();
    if (v !== undefined) {
        blade.value = v;
    }
    if (setValue) {
        blade.on('change', (ev) => {
            const value = getValue();
            if (value !== undefined && ev.value !== value) {
                blade.value = value;
                setValue(ev.value);
            }
        });
    } else {
        blade.disabled = true;
    }
    const removeStateListener = onChange(() => {
        const value = getValue();
        if (value !== undefined) {
            blade.value = value;
        }
    });
    cleanup(() => {
        blade.dispose();
        removeStateListener();
    });
}

/**
 * add a blade for slider panel
 */
export function addSliderBlade(
    guiFolder: FolderApi,
    model: NumericModel,
    params: Partial<SliderBladeParams>,
    cleanup: (d: Destructor) => void,
) {
    const blade = guiFolder.addBlade(configSliderBlade(params, model.range, model.getValue)) as SliderApi;
    wireBlade(blade, model, cleanup);
    return blade;
}

export function addTextBlade<T>(
    guiFolder: FolderApi,
    model: Model<T>,
    params: Partial<TextBladeParams<T>>,
    cleanup: (d: Destructor) => void,
) {
    const blade = guiFolder.addBlade(
        configTextBlade(params as Partial<TextBladeParams<unknown>>, model.getValue),
    ) as TextApi<T>;
    wireBlade(blade, model, cleanup);
    return blade;
}

export function addEnumListBlade(
    guiFolder: FolderApi,
    model: Model<number>,
    label: string,
    enumObj: { [name: string | number]: string | number },
    cleanup: (d: Destructor) => void,
) {
    const options = Object.values(enumObj)
        .filter<number>((k): k is number => typeof k === 'number')
        .filter((k) => !String(enumObj[k]).endsWith('_COUNT'))
        .map((value) => ({ value, text: String(enumObj[value]) }));
    return addListBlade(guiFolder, model, { label, options }, cleanup);
}

export function addListBlade<T>(
    guiFolder: FolderApi,
    model: Model<T>,
    params: Partial<ListBladeParams<T>>,
    cleanup: (d: Destructor) => void,
) {
    const blade = guiFolder.addBlade(configListBlade<T>(params, model.getValue)) as ListApi<T>;
    wireBlade(blade, model, cleanup);
    return blade;
}

/**
 * add a blade for cameraring
 */
export function addCameraRingBlade(
    guiFolder: FolderApi,
    model: Model<number>,
    params: { label: string } & Partial<RingInputParams>,
    cleanup: (d: Destructor) => void,
) {
    addInputBlade(guiFolder, model, { series: 0, ...params, view: 'cameraring' }, cleanup);
}

export function addButton(
    guiFolder: FolderApi,
    onClick: () => unknown,
    params: { label: string } & ButtonParams,
    cleanup: (d: Destructor) => void,
) {
    const button = guiFolder.addButton({ ...params }).on('click', onClick);
    cleanup(() => {
        button.dispose();
    });
}

export function addGraph(
    guiFolder: FolderApi,
    model: NumericModel,
    params: { label: string } & NumberMonitorParams,
    cleanup: (d: Destructor) => void,
) {
    const graph = guiFolder.addMonitor(
        {
            get value() {
                return model.getValue();
            },
        },
        'value',
        {
            ...params,
            view: 'graph',
            min: model.range[0],
            max: model.range[1],
        },
    );
    cleanup(() => {
        graph.dispose();
    });
}

export type InputBladeParams = { label: string } & Partial<InputParams>;

export function addInputBlade<T>(
    guiFolder: FolderApi,
    model: Model<T>,
    params: InputBladeParams,
    cleanup: (d: Destructor) => void,
) {
    const viewModel: Record<string, T> = {};
    const { label } = params;
    const value = model.getValue();
    if (value !== undefined) {
        viewModel[label] = value;
    }
    const input = guiFolder.addInput(viewModel, label, params);
    const bladeApi = Object.create(input, {
        value: {
            get: () => viewModel[label],
            set: (v: T) => {
                viewModel[label] = v;
                input.refresh();
            },
        },
    }) as BladeGuiApi<T>;
    wireBlade(bladeApi, model, cleanup);
    return input;
}
