# Creating the ticket folder in Postman (and adding requests)

The Postman MCP/connector has **no dedicated "create folder" tool**. In the Postman collection
format a folder is just a collection **item that has an `item` array instead of a `request`**:

```json
{
  "id": "a1b2c3d4-0001-4000-8000-000000000001",
  "name": "JIRA-12345",
  "item": []
}
```

So "create a folder" = update the whole collection to include that object. Use
`mcp__Postman__putCollection` (the full-collection update tool).

## Recommended flow

1. **Fetch the current collection in full** with `getCollection` (`model: "full"`). This is the
   source of truth you must preserve — its `info`, existing `item[]`, collection-level `event`
   (e.g. the pre-request **auth** script), and `variable[]`.
2. **Append the folder object** to the **top-level `item` array** (a new item with `name` = the
   ticket key and `item: []`). Generate a stable `id` for it (any UUID-like string) so you can
   target it later and so `run_folder`/`folderId` can resolve it.
3. **Replace the collection** with `putCollection`, sending the **entire** updated structure
   (info + schema + the full item tree incl. your new folder + event + variable).
   > ⚠️ `putCollection` **overwrites the whole collection**. If you send a partial body you will
   > clobber existing requests, the auth pre-request script, or variables. Always build the new
   > body from the full fetched collection — never from scratch.
4. **Add the test-case requests.** Two options:
   - **Per-request (preferred):** after the folder exists, call `createCollectionRequest` with
     `folderId` = your folder's id, once per case (cleaner, isolates each write, attaches
     `events`/test scripts directly).
   - **All-in-one:** include the requests inside the folder object's `item` array in the same
     `putCollection` call (fewer calls, but you hand-build the full request objects).

## Pitfalls / tips

- **Collection id format:** `getCollection`/`run_folder` use the owner-prefixed uid
  (`<owner>-<uuid>`); `createCollectionRequest`/`putCollection` take the bare collection id
  (`<uuid>`). Check the tool's parameter notes.
- **Idempotency:** if the ticket folder may already exist, look for it first (`list_folders` or scan
  the fetched collection's `item[]` by name) and reuse it instead of creating a duplicate.
- **Preserve the auth pre-request:** the collection-level `event` (prerequest) that fetches the
  token via `pm.sendRequest` must survive the `putCollection` — keep it in the body you send.
- **Concurrency:** create requests sequentially (each `createCollectionRequest` revises the
  collection); parallel writes can race on the collection revision.
- **Naming:** name the folder exactly the ticket key and each request after its case ID, so
  `run_folder({ folderName: "<ticket>" })` and the results map cleanly back to the matrix.

## Minimal example (append an empty folder, then add requests)

```jsonc
// after getCollection(model:"full") → collection
collection.item.push({ "id": "<uuid>", "name": "JIRA-12345", "item": [] });
// putCollection({ collectionId: "<bare-uuid>", collection })   // replaces whole collection
// then, per case:
// createCollectionRequest({ collectionId: "<bare-uuid>", folderId: "<uuid>", name, method, url, headerData, events })
```
