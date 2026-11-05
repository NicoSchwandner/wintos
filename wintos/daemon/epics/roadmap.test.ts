import { describe, expect, test } from "vitest";
import type { Unit } from "../projects/units";
import { editRoadmap, linkStep, mergedSteps, parseLinks, pruneLinks } from "./roadmap";

const u = (name: string, state: Unit["state"] = "todo"): Unit => ({ name, state });
const road = { steps: [u("Mapping", "done"), u("Cutover", "current"), u("Backfill")], links: { Cutover: ["s1"], Mapping: ["s0"] } };

describe("editRoadmap", () => {
    test("add goes to the end; a name it has already, or one with |, is refused", () => {
        const r = editRoadmap(road, { add: " Flag off " });
        expect(typeof r !== "string" && r.steps.at(-1)).toEqual(u("Flag off"));
        expect(typeof r !== "string" && r.note).toBe('added "Flag off"');
        expect(editRoadmap(road, { add: "backfill" })).toBe("the roadmap has that step already");
        expect(editRoadmap(road, { add: "a | b" })).toMatch(/without \|/);
    });
    test("a rename keeps its state and takes its sessions along", () => {
        const r = editRoadmap(road, { rename: { from: "Cutover", to: "Cutover per group" } });
        expect(typeof r !== "string" && r.steps[1]).toEqual(u("Cutover per group", "current"));
        expect(typeof r !== "string" && r.links).toEqual({ Mapping: ["s0"], "Cutover per group": ["s1"] });
        expect(editRoadmap(road, { rename: { from: "Cutover", to: "Backfill" } })).toBe("the roadmap has that step already");
        expect(editRoadmap(road, { rename: { from: "Nope", to: "x" } })).toBe("no such step");
    });
    test("move swaps with the neighbour; at the edge nothing changes and the agent hears nothing", () => {
        const r = editRoadmap(road, { move: { name: "Backfill", by: -1 } });
        expect(typeof r !== "string" && r.steps.map((x) => x.name)).toEqual(["Mapping", "Backfill", "Cutover"]);
        const edge = editRoadmap(road, { move: { name: "Mapping", by: -1 } });
        expect(typeof edge !== "string" && edge.note).toBe("");
    });
    test("done marks it, and off opens it again; the links stay so its sessions stay reachable", () => {
        const r = editRoadmap(road, { done: "Cutover", on: true });
        expect(typeof r !== "string" && r.steps[1]).toEqual(u("Cutover", "done"));
        expect(typeof r !== "string" && r.links.Cutover).toEqual(["s1"]);
        const back = editRoadmap(road, { done: "Mapping", on: false });
        expect(typeof back !== "string" && back.steps[0]).toEqual(u("Mapping"));
    });
    test("remove drops the step and its links", () => {
        const r = editRoadmap(road, { remove: "Cutover" });
        expect(typeof r !== "string" && r.steps.map((x) => x.name)).toEqual(["Mapping", "Backfill"]);
        expect(typeof r !== "string" && r.links).toEqual({ Mapping: ["s0"] });
    });
});

describe("links", () => {
    test("a session starting a step makes it current and is linked to it, once", () => {
        const r = linkStep(road, "Backfill", "s2")!;
        expect(r.steps.map((x) => x.state)).toEqual(["done", "todo", "current"]);
        expect(linkStep(r, "Backfill", "s2")!.links.Backfill).toEqual(["s2"]);
        expect(linkStep(road, "Nope", "s2")).toBeUndefined();
    });
    test("links to steps that are gone are dropped; a broken front-matter value reads as none", () => {
        expect(pruneLinks(road.links, [u("Cutover")])).toEqual({ Cutover: ["s1"] });
        expect(parseLinks('{"a":["s1"],"b":3}')).toEqual({ a: ["s1"] });
        expect(parseLinks("{oops")).toEqual({});
    });
});

test("a step naming a merged PR is done by itself; one naming an open PR, or none, is not", () => {
    const steps = [u("Core#14715 on test"), u("core #14717 merged"), u("Receipt routines seed"), u("Core#14692 merged", "done")];
    expect(mergedSteps(steps, [{ repo: "acme/Core", number: 14715 }, { repo: "acme/Core", number: 14692 }])).toEqual(["Core#14715 on test"]);
    expect(mergedSteps(steps, [{ repo: "acme/Core", number: 14717 }])).toEqual(["core #14717 merged"]);
    expect(mergedSteps(steps, [{ repo: "acme/Other", number: 14715 }])).toEqual([]);
});
