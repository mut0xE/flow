import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { readFileSync } from "fs";
import { join } from "path";

const idl = JSON.parse(
  readFileSync(join(__dirname, "../src/idl/flow.json"), "utf-8")
);

const codama = createFromRoot(rootNodeFromAnchor(idl));

codama.accept(
  renderVisitor(join(__dirname, ".."), {
    generatedFolder: "src/generated",
    deleteFolderBeforeRendering: true,
  })
);

console.log("Codama client generated → src/generated/");
