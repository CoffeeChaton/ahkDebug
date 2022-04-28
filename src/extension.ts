import {
    debug,
    ExtensionContext,
    workspace,
} from 'vscode';
import { configChangEvent } from './configUI';
import { NekoDebugMain } from './provider/debugger/NekoDebugMain';

// main
export function activate(context: ExtensionContext): void {
    context.subscriptions.push(
        // workspace-------------------
        workspace.onDidChangeConfiguration((): void => configChangEvent()),
        // debug
        debug.registerDebugAdapterDescriptorFactory('ahk', NekoDebugMain),
    );
}

// this method is called when your extension is deactivated
export function deactive(): void {
}
