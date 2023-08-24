class SyncProtocolServer {
    private syncedRevision = 0

    constructor(private db: any, private conn: any) {

    }

    sendAnyChanges() {
        // Get all changes after syncedRevision that was not performed by the client we're talkin' to.
        var changes = this.db.changes.filter(function (change) { return change.rev > this.syncedRevision && change.source !== this.conn.clientIdentity; });
        // Compact changes so that multiple changes on same object is merged into a single change.
        var reducedSet = reduceChanges(changes);
        // Convert the reduced set into an array again.
        var reducedArray = Object.keys(reducedSet).map(function (key) { return reducedSet[key]; });
        // Notice the current revision of the database. We want to send it to client so it knows what to ask for next time.
        var currentRevision = this.db.revision;

        this.send(this.conn, JSON.stringify({
            type: "changes",
            changes: reducedArray,
            currentRevision: currentRevision,
            partial: false // Tell client that these are the only changes we are aware of. Since our mem DB is syncronous, we got all changes in one chunk.
        }));

        this.syncedRevision = currentRevision; // Make sure we only send revisions coming after this revision next time and not resend the above changes over and over.
    }


    send(conn: any, payload: string) {

    }
}


// CREATE / UPDATE / DELETE constants:
var CREATE = 1,
    UPDATE = 2,
    DELETE = 3;

function reduceChanges(changes) {
    // Converts an Array of change objects to a set of change objects based on its unique combination of (table ":" key).
    // If several changes were applied to the same object, the resulting set will only contain one change for that object.
    return changes.reduce(function (set, nextChange) {
        var id = nextChange.table + ":" + nextChange.key;
        var prevChange = set[id];
        if (!prevChange) {
            // This is the first change on this key. Add it unless it comes from the source that we are working against
            set[id] = nextChange;
        } else {
            // Merge the oldchange with the new change
            set[id] = (function () {
                switch (prevChange.type) {
                    case CREATE:
                        switch (nextChange.type) {
                            case CREATE: return nextChange; // Another CREATE replaces previous CREATE.
                            case UPDATE: return combineCreateAndUpdate(prevChange, nextChange); // Apply nextChange.mods into prevChange.obj
                            case DELETE: return nextChange;  // Object created and then deleted. If it wasnt for that we MUST handle resent changes, we would skip entire change here. But what if the CREATE was sent earlier, and then CREATE/DELETE at later stage? It would become a ghost object in DB. Therefore, we MUST keep the delete change! If object doesnt exist, it wont harm!
                        }
                        break;
                    case UPDATE:
                        switch (nextChange.type) {
                            case CREATE: return nextChange; // Another CREATE replaces previous update.
                            case UPDATE: return combineUpdateAndUpdate(prevChange, nextChange); // Add the additional modifications to existing modification set.
                            case DELETE: return nextChange;  // Only send the delete change. What was updated earlier is no longer of interest.
                        }
                        break;
                    case DELETE:
                        switch (nextChange.type) {
                            case CREATE: return nextChange; // A resurection occurred. Only create change is of interest.
                            case UPDATE: return prevChange; // Nothing to do. We cannot update an object that doesnt exist. Leave the delete change there.
                            case DELETE: return prevChange; // Still a delete change. Leave as is.
                        }
                        break;
                }
            })();
        }
        return set;
    }, {});
}

function combineCreateAndUpdate(prevChange, nextChange) {
    var clonedChange = deepClone(prevChange);// Clone object before modifying since the earlier change in db.changes[] would otherwise be altered.
    applyModifications(clonedChange.obj, nextChange.mods); // Apply modifications to existing object.
    return clonedChange;
}

function combineUpdateAndUpdate(prevChange, nextChange) {
    var clonedChange = deepClone(prevChange); // Clone object before modifying since the earlier change in db.changes[] would otherwise be altered.
    Object.keys(nextChange.mods).forEach(function (keyPath) {
        // If prev-change was changing a parent path of this keyPath, we must update the parent path rather than adding this keyPath
        var hadParentPath = false;
        Object.keys(prevChange.mods).filter(function (parentPath) { return keyPath.indexOf(parentPath + '.') === 0 }).forEach(function (parentPath) {
            setByKeyPath(clonedChange.mods[parentPath], keyPath.substr(parentPath.length + 1), nextChange.mods[keyPath]);
            hadParentPath = true;
        });
        if (!hadParentPath) {
            // Add or replace this keyPath and its new value
            clonedChange.mods[keyPath] = nextChange.mods[keyPath];
        }
        // In case prevChange contained sub-paths to the new keyPath, we must make sure that those sub-paths are removed since
        // we must mimic what would happen if applying the two changes after each other:
        Object.keys(prevChange.mods).filter(function (subPath) { return subPath.indexOf(keyPath + '.') === 0 }).forEach(function (subPath) {
            delete clonedChange.mods[subPath];
        });
    });
    return clonedChange;
}


function setByKeyPath(obj, keyPath, value) {
    if (!obj || typeof keyPath !== 'string') return;
    var period = keyPath.indexOf('.');
    if (period !== -1) {
        var currentKeyPath = keyPath.substr(0, period);
        var remainingKeyPath = keyPath.substr(period + 1);
        if (remainingKeyPath === "")
            obj[currentKeyPath] = value;
        else {
            var innerObj = obj[currentKeyPath];
            if (!innerObj) innerObj = (obj[currentKeyPath] = {});
            setByKeyPath(innerObj, remainingKeyPath, value);
        }
    } else {
        obj[keyPath] = value;
    }
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function applyModifications(obj, modifications) {
    Object.keys(modifications).forEach(function (keyPath) {
        setByKeyPath(obj, keyPath, modifications[keyPath]);
    });
    return obj;
}