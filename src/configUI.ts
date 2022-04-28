/* eslint no-magic-numbers: ["error", { "ignore": [0,1,2,3,4,5,10] }] */
import * as fs from 'fs';
import * as vscode from 'vscode';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DeepReadonly<T> = T extends (...args: any) => any ? T : { readonly [P in keyof T]: DeepReadonly<T[P]> };

type TempConfigs = {
    Debug: {
        executePath: string;
    };
};
type TConfigs = DeepReadonly<TempConfigs>;

function checkDebugFile(executePath: string): void {
    fs.access(executePath, (err: NodeJS.ErrnoException | null): void => {
        if (err === null) return;
        const errCode = err.message
            ? ` <---> err.message ${err.message}`
            : '';
        const msg = `setting err of "AhkNekoHelp.Debug.executePath" : "${executePath}"${errCode}`;
        void vscode.window.showErrorMessage(msg);
        const msg2 = `can't find the file at "${executePath}"`;
        void vscode.window.showErrorMessage(msg2);
    });
}

// --------
let Configs: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('AhkNekoHelp');

function checkConfig<T>(section: string): T {
    const ed: T | undefined = Configs.get<T>(section);
    if (ed !== undefined) return ed;
    throw new Error(`${section}, not found err code--40--11--33-- at configUI.ts`);
}

function getConfig(): TConfigs {
    const ed: TConfigs = {
        Debug: {
            executePath: checkConfig<string>('Debug.executePath'),
        },
    } as const;
    checkDebugFile(ed.Debug.executePath);
    return ed;
}

let config: TConfigs = getConfig();

export function configChangEvent(): void {
    Configs = vscode.workspace.getConfiguration('AhkNekoHelp');
    config = getConfig();
}

export function getDebugPath(): string {
    checkDebugFile(config.Debug.executePath);
    return config.Debug.executePath;
}
