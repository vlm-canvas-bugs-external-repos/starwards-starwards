import { RadarDriver, makeDriver } from './driver';
import { expect, test } from '@playwright/test';

import { maps } from '@starwards/server';

const { test_map_1 } = maps;
const gameDriver = makeDriver(test);

test('start and stop a game', async ({ page }) => {
    await page.goto(`/`);
    await expect(page.locator('[data-id="title"]')).toHaveText('Starwards');
    expect(gameDriver.gameManager.state.isGameRunning).toBe(false);
    const newGame = page.locator('[data-id="new game"]');
    await newGame.click({ delay: 200 });
    await newGame.waitFor({ state: 'detached' });
    expect(gameDriver.gameManager.state.isGameRunning).toBe(true);
    await page.locator('[data-id="stop game"]').click({ delay: 200 });
    await newGame.waitFor({ state: 'visible' });
    expect(gameDriver.gameManager.state.isGameRunning).toBe(false);
});

test('armor view', async ({ page }) => {
    await gameDriver.gameManager.startGame(test_map_1);
    await page.goto(`/ship.html?ship=${test_map_1.testShipId}`);
    await page.locator('[data-id="menu-armor"]').dragTo(page.locator('#layoutContainer'));
    const radarCanvas = page.locator('[data-id="Armor"]');
    expect(await radarCanvas.screenshot()).toMatchSnapshot();
});

test('tactical radar view', async ({ page }) => {
    await gameDriver.gameManager.startGame(test_map_1);
    await page.goto(`/ship.html?ship=${test_map_1.testShipId}`);
    await page.locator('[data-id="menu-tactical radar"]').dragTo(page.locator('#layoutContainer'));
    const radarCanvas = page.locator('[data-id="Tactical Radar"]');
    expect(await radarCanvas.screenshot()).toMatchSnapshot();
});

test('main screen', async ({ page }) => {
    test.setTimeout(1 * 60 * 1000);
    await gameDriver.gameManager.startGame(test_map_1);
    await page.goto(`/main-screen.html?ship=${test_map_1.testShipId}`);
    const canvas = page.locator('[data-id="3dCanvas"][data-loaded="true"]');
    expect(await canvas.screenshot()).toMatchSnapshot();
});

test('GM view', async ({ page }) => {
    await gameDriver.gameManager.startGame(test_map_1);
    const ship = gameDriver.gameManager.scriptApi.getShip(test_map_1.testShipId);
    if (!ship) {
        throw new Error(`ship ${test_map_1.testShipId} not found`);
    }
    ship.spaceObject.radarRange = 3_000;
    await page.goto(`/gm.html`);
    const radar = new RadarDriver(page.locator('[data-id="GM Radar"]'));
    await radar.setZoom(0.1);
    expect(await radar.canvas.screenshot()).toMatchSnapshot();
});
