import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { stringToBase64 } from "@/util/util";

// A prompt into a Claude pane: the text, then Enter on its own, so Claude doesn't take both for one paste.
export async function typeIntoPane(blockId: string, text: string): Promise<void> {
    const type = (t: string) => RpcApi.ControllerInputCommand(TabRpcClient, { blockid: blockId, inputdata64: stringToBase64(t) });
    await type(text);
    await new Promise((done) => setTimeout(done, 300));
    await type("\r");
}
