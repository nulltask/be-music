import type { GUI } from 'lil-gui';
import { describe, expect, test, vi } from 'vite-plus/test';
import type { DemoGUIState } from '../../types.ts';
import { applyNonstopPlacement, buildCourseFolder } from './course.ts';
import type { DebugMenu } from './index.ts';

/** A stand-in for a lil-gui controller bound to `object[property]`. */
class FakeController {
  public label = '';
  private readonly object: Record<string, unknown>;
  private readonly property: string;
  private changeHandler: ((value: unknown) => void) | undefined;

  public constructor(object: Record<string, unknown>, property: string) {
    this.object = object;
    this.property = property;
  }

  public name(label: string): this {
    this.label = label;
    return this;
  }

  public onChange(handler: (value: unknown) => void): this {
    this.changeHandler = handler;
    return this;
  }

  /** What lil-gui does on a pick: writes the bound property, then calls the change handler. */
  public pick(value: unknown): void {
    this.object[this.property] = value;
    this.changeHandler?.(value);
  }
}

/** A stand-in for a lil-gui folder that keeps the controllers added to it. */
class FakeFolder {
  public readonly controllers: FakeController[] = [];

  public add(object: Record<string, unknown>, property: string): FakeController {
    const controller = new FakeController(object, property);
    this.controllers.push(controller);
    return controller;
  }

  public controller(label: string): FakeController {
    const found = this.controllers.find((controller) => controller.label === label);
    if (found === undefined) throw new Error(`no controller named ${label}`);
    return found;
  }
}

function courseSettings(): DemoGUIState {
  return { courseAutoAdvance: false, nonstopPlacement: 'intended' } as DemoGUIState;
}

/** Builds the Course folder into a fake folder, with the menu's members it reaches stubbed. */
function buildFolder() {
  const settings = courseSettings();
  const refreshSelectRecords = vi.fn();
  const tracked: unknown[] = [];
  const menu = {
    guiState: settings,
    deps: { settings, refreshSelectRecords },
    courseMaker: { panel: undefined },
    library: { importCourseTables: vi.fn() },
    setStatus: vi.fn(),
    trackPlayOption: (controller: unknown) => {
      tracked.push(controller);
      return controller;
    },
  };
  const folder = new FakeFolder();
  buildCourseFolder.call(menu as unknown as DebugMenu, folder as unknown as GUI);
  return { settings, refreshSelectRecords, tracked, folder };
}

describe('applyNonstopPlacement', () => {
  test('keeps the placement and has the select screen draw its records again', () => {
    const settings = courseSettings();
    const refreshSelectRecords = vi.fn();

    applyNonstopPlacement({ settings, refreshSelectRecords }, 'lr2');

    expect(settings.nonstopPlacement).toBe('lr2');
    expect(refreshSelectRecords).toHaveBeenCalledTimes(1);
  });
});

describe('buildCourseFolder', () => {
  test('redraws the select screen when the NONSTOP placement is picked', () => {
    const { settings, refreshSelectRecords, folder } = buildFolder();

    folder.controller('NONSTOP placement').pick('lr2');

    expect(settings.nonstopPlacement).toBe('lr2');
    expect(refreshSelectRecords).toHaveBeenCalledTimes(1);

    folder.controller('NONSTOP placement').pick('intended');

    expect(settings.nonstopPlacement).toBe('intended');
    expect(refreshSelectRecords).toHaveBeenCalledTimes(2);
  });

  test('locks the NONSTOP placement during a play, as an option a play latches', () => {
    const { tracked, folder } = buildFolder();

    expect(tracked).toContain(folder.controller('NONSTOP placement'));
  });

  test('leaves the select screen alone for the other course settings', () => {
    const { settings, refreshSelectRecords, folder } = buildFolder();

    folder.controller('Skip stage results').pick(true);

    expect(settings.courseAutoAdvance).toBe(true);
    expect(refreshSelectRecords).not.toHaveBeenCalled();
  });
});
