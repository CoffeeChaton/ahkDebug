/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable max-lines */
/* eslint no-magic-numbers: ["error", { "ignore": [-1,0,1,2,100,300,5000,131072] }] */
import { Scope, StackFrame, Variable } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { getPort } from 'get-port-please';
import { resolve } from 'path';
import { OutputChannel } from '../../tools/OutputChannel';
import { mapToStr } from '../../tools/str/mapToStr';
import { startDebugger } from '../Service/Service';
import { DebugServer } from './debugServer';
import {
    EVarScope,
    EVarScopeStr,
    TDbgpResponse,
    TLaunchRequestArguments,
} from './DebugTypeEnum';
import { BreakPointHandler } from './handler/breakpointHandler';
import { CommandHandler } from './handler/commandHandler';
import { fnObtainValueSet } from './handler/fnObtainValueSet';
import { StackHandler } from './handler/StackHandler';
import { VariableHandler } from './handler/variableHandler';

const ports: number[] = [];
for (let i = 4000; i < 5000; i++) ports.push(i);

/**
 * A Ahk runtime debugger.
 * refrence: https://xdebug.org/docs/dbgp
 */
export class DebugDispather extends EventEmitter {
    private debugServer!: DebugServer;

    private commandHandler!: CommandHandler;

    private startArgs!: TLaunchRequestArguments;

    private readonly breakPointHandler: BreakPointHandler = new BreakPointHandler();

    private readonly variableHandler: VariableHandler = new VariableHandler();

    // public constructor() {
    //     super({ captureRejections: true });
    // }

    /**
     * Start executing the given program.
     */
    public async start(args: TLaunchRequestArguments): Promise<void> {
        const { runtime } = args;
        if (!existsSync(runtime)) {
            const message = `AHK Execute Bin Not Found : ${runtime} --112--883--963--by neko-help`;
            OutputChannel.appendLine(message);
            OutputChannel.show();
            this.end();
            return;
        }

        this.startArgs = args;
        const maxChildren: number = args.dbgpSettings.max_children || 300;
        const maxData: number = args.dbgpSettings.max_data || 131072;

        if (!Number.isInteger(maxChildren)) {
            const message = 'max_children !== number';
            console.error(message, maxChildren);
            throw new Error(message);
        }
        if (!Number.isInteger(maxData)) {
            const message = 'max_data !== number';
            console.error(message, maxData);
            throw new Error(message);
        }

        const port = await getPort({
            name: 'neko-ahk-debug',
            ports,
        });
        this.debugServer = new DebugServer(port);
        this.commandHandler = new CommandHandler(this.debugServer);
        this.debugServer
            .on('init', () => {
                this.breakPointHandler.loopPoints((bp) => {
                    this.setBreakPonit(bp);
                });
                this.sendComand(`feature_set -n max_children -v ${maxChildren}`);
                this.sendComand(`feature_set -n max_data -v ${maxData}`);
                this.sendComand('feature_set -n max_depth -v 2'); // Get properties recursively. Therefore, fixed at 2
                this.sendComand('stdout -c 1');
                this.sendComand('stderr -c 1');
                this.sendComand('run');
            })
            .on('stream', (stream) => {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                this.emit('output', Buffer.from(stream.content as string, 'base64').toString());
            })
            .on('response', (response: TDbgpResponse) => {
                if (!(response.attr.command)) return;
                this.commandHandler.fnCallback(response.attr.transaction_id, response);
                switch (response.attr.command) {
                    case 'run':
                    case 'step_into':
                    case 'step_over':
                    case 'step_out':
                        this.processRunResponse(response);
                        break;
                    case 'stop':
                        this.end();
                        break;
                    default:
                        break;
                }
            });

        const cwd = { cwd: `${resolve(args.program, '..')}` };
        const ahkProcess = spawn(runtime, ['/ErrorStdOut', `/debug=localhost:${port}`, args.program], cwd);
        ahkProcess.stderr.on('data', (err) => {
            const err2 = err as Buffer; // just has .toString('utf8') not mean as Buffer
            this.emit('output', err2.toString('utf8'));
            this.end();
        });
    }

    public restart(): void {
        this.sendComand('stop');
        this.end();
        startDebugger(this.startArgs.program);
    }

    /**
     * send command to the ahk debug proxy.
     */
    public async sendComand(command: string, data?: string): Promise<TDbgpResponse> {
        const ed: TDbgpResponse = await this.commandHandler.sendComand(command, data);
        return ed;
    }

    /**
     * receive stop request from vscode, send command to notice the script stop.
     */
    public stop(): void {
        this.sendComand('stop');
        this.debugServer.shutdown();
    }

    /**
     * receive end message from script, send event to stop the debug session.
     */
    public end(): void {
        this.emit('end');
        this.debugServer.shutdown();
    }

    public scopes(frameId: number): Scope[] {
        return this.variableHandler.scopes(frameId);
    }

    /**
     * List all variable or get refrence variable property detail.
     * @param args
     */
    public async listVariables(args: DebugProtocol.VariablesArguments): Promise<Variable[]> {
        if (args.filter === 'named') {
            return [];
        }
        if (args.filter === 'indexed') {
            if (args.start === undefined) throw new Error('args.start === undefined at --77--241--81');
            if (args.count === undefined) throw new Error('args.count === undefined at --77--241--82');
            return this.variableHandler.getArrayValue(args.variablesReference, args.start, args.count);
        }

        const scope: number = this.variableHandler.getScopeByRef(args.variablesReference);
        const frameId: number = this.variableHandler.getFrameId();

        const property = this.variableHandler.getVarByRef(args.variablesReference);
        if (
            property !== EVarScopeStr.Local
            && property !== EVarScopeStr.Global
        ) {
            // address
            return this.getVariable(frameId, scope, property.name);
        }

        const command = `context_get -d ${frameId} -c ${scope}`;
        const response = await this.sendComand(command);
        if (!response) throw new Error(`--4589--33--22--11 command as ${command}`);

        return (this.variableHandler.parse(response, scope));
    }

    public async getVariableByEval(args: DebugProtocol.EvaluateArguments): Promise<string> {
        const variableName: string = args.expression;

        if (args.context === 'variables') {
            return variableName;
        }

        const frameId: number = this.variableHandler.getFrameId();

        const varLocal = await this.getVariable(frameId, EVarScope.LOCAL, variableName);
        switch (varLocal.length) {
            case 0:
                break;
            case 1:
                return varLocal[0].value;
            default: {
                const ed = this.getVariableByEvalDefault(varLocal, variableName);
                if (ed) return ed;
                break;
            }
        }

        const varGlobal = await this.getVariable(frameId, EVarScope.GLOBAL, variableName);
        switch (varGlobal.length) {
            case 0:
                return 'undefined value of Variable';
            case 1:
                return varGlobal[0].value;
            default: {
                const ed = this.getVariableByEvalDefault(varGlobal, variableName);
                if (ed) return ed;
                break;
            }
        }
        return 'neko-err--85--44--99--';
    }

    public async setVariable(args: DebugProtocol.SetVariableArguments): Promise<{
        name: string;
        value: string;
        type: string;
        variablesReference: number;
    }> {
        const a = fnObtainValueSet(args.value);
        let { value } = a;
        let { type } = a;

        const frameId: number = this.variableHandler.getFrameId();
        const scope: number = this.variableHandler.getScopeByRef(args.variablesReference);
        const { isVariable } = a;
        if (isVariable) {
            const ahkVar = (await this.getVariable(frameId, scope, value))[0];
            value = ahkVar.value;
            if (value.match(/^"|"$/gu)) {
                type = 'string';
                value = value.replace(/^"|"$/gu, '');
            }
        }

        let fullname: string = args.name;
        const parentFullName = this.variableHandler.getVarByRef(args.variablesReference);
        if (
            parentFullName !== EVarScopeStr.Local
            && parentFullName !== EVarScopeStr.Global
        ) {
            const isIndex: boolean = fullname.includes('[') && fullname.includes(']');
            fullname = isIndex
                ? `${parentFullName.name}${fullname}`
                : `${parentFullName.name}.${fullname}`;
        }

        const response: TDbgpResponse = await this.sendComand(
            `property_set -d ${frameId} -c ${scope} -n ${fullname} -t ${type}`,
            value,
        );
        if (response.attr.success === '1') {
            throw new Error(`"${fullname}" cannot be written. Probably read-only.--044--33--66`);
        }

        const displayValue = type === 'string'
            ? `"${value}"`
            : value;
        const PRIMITIVE = 0;
        return {
            name: args.name,
            value: displayValue,
            type,
            variablesReference: PRIMITIVE,
        };
    }

    public async stack(args: DebugProtocol.StackTraceArguments): Promise<StackFrame[]> {
        const response = await this.sendComand('stack_get');
        return StackHandler(args, response);
    }

    public buildBreakPoint(
        path: string,
        sourceBreakpoints: DebugProtocol.SourceBreakpoint[],
    ): DebugProtocol.Breakpoint[] {
        this.clearBreakpoints(path);
        return this.breakPointHandler.buildBreakPoint(path, sourceBreakpoints, (bp) => {
            this.setBreakPonit(bp);
        });
    }

    private getVariableByEvalDefault(varList: Variable[], variableName: string): string {
        const valNameList: string[] = [variableName];
        varList.forEach((v) => {
            valNameList.push(v.name);
        });
        const endStrList: string[] = [];

        for (const valName of valNameList) {
            const ahkVar = this.variableHandler.getVarByFullname(valName);
            if (!ahkVar) {
                continue;
            }
            if (typeof ahkVar.value !== 'string') {
                return 'not support Complex structure';
            }
            const edStr: string = mapToStr(ahkVar.value);
            endStrList.push(edStr);
        }

        return endStrList.join('\n');
    }

    private async getVariable(frameId: number, scope: EVarScope, variableName: string): Promise<Variable[]> {
        const response = await this.sendComand(`property_get -d ${frameId} -c ${scope} -n ${variableName}`);
        // -p  : the port that the IDE listens for debugging on. The address is retrieved from the connection information.

        return this.variableHandler.parsePropertyget(response, scope);
    }

    private async setBreakPonit(bp: DebugProtocol.Breakpoint): Promise<void> {
        if (!(this.debugServer && bp.verified)) return;
        const res = await this.sendComand(
            `breakpoint_set -t line -f ${bp.source?.path ?? ''} -n ${bp?.line ?? ''}`,
        );
        // eslint-disable-next-line no-param-reassign
        bp.id = res.attr.id;
    }

    /**
     * Clear all breakpoints for file.
     * @param path file path
     */
    private clearBreakpoints(path: string): null {
        if (!this.debugServer) return null;
        const bps: DebugProtocol.Breakpoint[] = this.breakPointHandler.getBt(path) ?? [];
        if (!(bps.length > 0)) return null;

        bps.forEach((bp) => {
            if (bp.id) {
                this.sendComand(`breakpoint_remove -d ${bp.id}`);
            }
        });

        return null;
    }

    private processRunResponse(response: TDbgpResponse): void {
        switch (response.attr.status) {
            case 'break':
                this.emit('break', response.attr.command);
                break;
            case 'stopping':
            case 'stopped':
                this.end();
                break;
            default:
                break;
        }
    }
}
