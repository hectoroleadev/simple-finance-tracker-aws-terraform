const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, BatchWriteCommand, DeleteCommand, QueryCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { z } = require("zod");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const ITEMS_TABLE = process.env.ITEMS_TABLE_NAME;
const HISTORY_TABLE = process.env.HISTORY_TABLE_NAME;
const CATEGORIES_TABLE = process.env.CATEGORIES_TABLE_NAME;
const USER_SHARES_TABLE = process.env.USER_SHARES_TABLE_NAME;
const ITEM_HISTORY_TABLE = process.env.ITEM_HISTORY_TABLE_NAME;

// Validation Schemas
const FinanceItemSchema = z.object({
    id: z.string().uuid().or(z.string().regex(/^h\d+$/)), // Supports UUID and legacy IDs
    name: z.string().min(1),
    amount: z.number(),
    category: z.string().min(1), // Now accepts any string (category ID or legacy name)
});

const CategorySchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    effect: z.enum(["POSITIVE", "NEGATIVE", "INFORMATIVE", "INFORMATIVE_STAT"]),
    color: z.string().optional(),
    order: z.number().optional(),
});

const HistoryEntrySchema = z.object({
    id: z.string(),
    date: z.string().datetime(),
    savings: z.number(),
    debt: z.number(),
    balance: z.number(),
    retirement: z.number(),
    year: z.number().optional(),
    month: z.string().optional(),
});

const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
};

exports.handler = async (event) => {
    console.log("Event:", JSON.stringify(event));

    // Support both HTTP API (v2) and REST API (v1)
    const method = event.httpMethod || event.requestContext?.http?.method;
    const path = event.path || event.rawPath;

    // Extract userId from Cognito claims. 
    // Fallback to 'anonymous' if no claims found (should not happen with authorizer)
    const userClaims = event.requestContext?.authorizer?.claims;
    const userId = userClaims?.['cognito:username'] || userClaims?.sub || 'anonymous';

    if (method === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    const queryParams = event.queryStringParameters || {};
    const targetUserId = queryParams.viewAs && queryParams.viewAs !== userId ? queryParams.viewAs : userId;

    try {
        if (path === "/items" || path === "/items/") {
            if (method === "GET") {
                return await getItems(targetUserId, userId);
            } else if (method === "POST") {
                const body = JSON.parse(event.body);
                if (body.items) {
                    return await saveItems(body.items, userId);
                }
            }
        } else if (path.startsWith("/items/") && method === "DELETE") {
            const id = path.split("/").pop();
            if (id) {
                return await deleteItem(id, userId);
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ message: "Missing id in path" }),
                };
            }
        } else if (path === "/history") {
            if (method === "GET") {
                return await getHistory(targetUserId, userId);
            } else if (method === "POST") {
                const body = JSON.parse(event.body);
                if (body.history) {
                    return await saveHistory(body.history, userId);
                }
            }
        } else if (path.startsWith("/history/") && method === "DELETE") {
            const id = path.split("/").pop();
            if (id) {
                return await deleteHistoryItem(id, userId);
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ message: "Missing id in path" }),
                };
            }
        } else if (path.match(/^\/items\/[^/]+\/history\/?$/) && method === "GET") {
            const id = path.split("/")[2];
            if (id) {
                return await getItemHistory(id, userId);
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ message: "Missing id in path" }),
                };
            }
        } else if (path === "/categories" || path === "/categories/") {
            if (method === "GET") {
                return await getCategories(targetUserId, userId);
            } else if (method === "POST") {
                const body = JSON.parse(event.body);
                if (body.categories) {
                    return await saveCategories(body.categories, userId);
                }
                return { statusCode: 400, headers, body: JSON.stringify({ message: "Missing categories in body" }) };
            }
        } else if (path === "/shares" || path === "/shares/") {
            if (method === "GET") {
                return await getMyShares(userId);
            } else if (method === "POST") {
                const body = JSON.parse(event.body);
                return await createShare(userId, body.sharedWithId);
            }
        } else if (path.startsWith("/shares/") && method === "DELETE") {
            const sharedWithId = path.split("/").pop();
            return await deleteShare(userId, sharedWithId);
        } else if (path === "/shared-with-me") {
            return await getSharedWithMe(userId);
        }

        return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ message: "Not Found" }),
        };
    } catch (error) {
        console.error("Error:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message: "Internal Server Error", error: error.message }),
        };
    }
};

async function getItems(targetUserId, requesterId) {
    if (targetUserId !== requesterId) {
        const hasAccess = await checkAccess(targetUserId, requesterId);
        if (!hasAccess) {
            return { statusCode: 403, headers, body: JSON.stringify({ message: "Forbidden: No shared access" }) };
        }
    }

    const items = await queryAllPages({
        TableName: ITEMS_TABLE,
        IndexName: "UserIndex",
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": targetUserId }
    });

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ items }),
    };
}

async function getItemHistory(itemId, userId) {
    // Verify ownership using GetItem (faster than Query — direct PK lookup)
    const checkItemResponse = await docClient.send(new GetCommand({
        TableName: ITEMS_TABLE,
        Key: { id: itemId }
    }));
    const item = checkItemResponse.Item;

    if (!item || (item.userId !== userId && !(await checkAccess(item.userId, userId)))) {
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ message: "Forbidden: You do not have access to this item's history" })
        };
    }

    const history = await queryAllPages({
        TableName: process.env.ITEM_HISTORY_TABLE_NAME,
        KeyConditionExpression: "itemId = :itemId",
        ExpressionAttributeValues: {
            ":itemId": itemId
        },
        ScanIndexForward: false
    });

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ history }),
    };
}

async function saveItems(items, userId) {
    // Validation
    const validation = z.array(FinanceItemSchema).safeParse(items);
    if (!validation.success) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ message: "Invalid items format", errors: validation.error.format() }),
        };
    }

    if (items.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ message: "No items to save" }) };
    }

    // Assign userId to all items
    const itemsWithUser = items.map(item => ({ ...item, userId }));

    // DynamoDB BatchWrite limit is 25
    const chunks = chunkArray(itemsWithUser, 25);

    for (const chunk of chunks) {
        const putRequests = chunk.map((item) => ({
            PutRequest: { Item: item },
        }));

        const command = new BatchWriteCommand({
            RequestItems: {
                [ITEMS_TABLE]: putRequests,
            },
        });
        await docClient.send(command);
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "Items saved successfully" }),
    };
}

async function getHistory(targetUserId, requesterId) {
    if (targetUserId !== requesterId) {
        const hasAccess = await checkAccess(targetUserId, requesterId);
        if (!hasAccess) {
            return { statusCode: 403, headers, body: JSON.stringify({ message: "Forbidden: No shared access" }) };
        }
    }

    const history = await queryAllPages({
        TableName: HISTORY_TABLE,
        IndexName: "UserIndex",
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": targetUserId },
        ScanIndexForward: false // Newest first
    });

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ history }),
    };
}

async function saveHistory(historyEntries, userId) {
    // Validation
    const validation = z.array(HistoryEntrySchema).safeParse(historyEntries);
    if (!validation.success) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ message: "Invalid history format", errors: validation.error.format() }),
        };
    }

    if (historyEntries.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ message: "No history to save" }) };
    }

    // Assign userId to all entries
    const entriesWithUser = historyEntries.map(entry => ({ ...entry, userId }));

    const chunks = chunkArray(entriesWithUser, 25);

    for (const chunk of chunks) {
        const putRequests = chunk.map((entry) => ({
            PutRequest: { Item: entry },
        }));

        const command = new BatchWriteCommand({
            RequestItems: {
                [HISTORY_TABLE]: putRequests,
            },
        });
        await docClient.send(command);
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "History saved successfully" }),
    };
}

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

// Fetches all pages of a Query result, handling DynamoDB's 1MB response limit.
async function queryAllPages(params) {
    let items = [];
    let lastKey = undefined;

    do {
        const command = new QueryCommand({ ...params, ExclusiveStartKey: lastKey });
        const response = await docClient.send(command);
        items = items.concat(response.Items || []);
        lastKey = response.LastEvaluatedKey;
    } while (lastKey);

    return items;
}

async function deleteItem(id, userId) {
    const command = new DeleteCommand({
        TableName: ITEMS_TABLE,
        Key: { id },
        ConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId }
    });
    try {
        await docClient.send(command);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ message: "Item deleted successfully" }),
        };
    } catch (err) {
        if (err.name === "ConditionalCheckFailedException") {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ message: "Forbidden: You do not have permission to delete this item" }),
            };
        }
        throw err;
    }
}

async function deleteHistoryItem(id, userId) {
    const command = new DeleteCommand({
        TableName: HISTORY_TABLE,
        Key: { id },
        ConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId }
    });
    try {
        await docClient.send(command);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ message: "History item deleted successfully" }),
        };
    } catch (err) {
        if (err.name === "ConditionalCheckFailedException") {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ message: "Forbidden: You do not have permission to delete this history item" }),
            };
        }
        throw err;
    }
}

// --- Categories ---

async function getCategories(targetUserId, requesterId) {
    if (targetUserId !== requesterId) {
        const hasAccess = await checkAccess(targetUserId, requesterId);
        if (!hasAccess) {
            return { statusCode: 403, headers, body: JSON.stringify({ message: "Forbidden: No shared access" }) };
        }
    }

    const categories = await queryAllPages({
        TableName: CATEGORIES_TABLE,
        IndexName: "UserIndex",
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": targetUserId }
    });

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ categories }),
    };
}

async function saveCategories(categories, userId) {
    const validation = z.array(CategorySchema).safeParse(categories);
    if (!validation.success) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ message: "Invalid categories format", errors: validation.error.format() }),
        };
    }

    // Attach userId to incoming categories
    const categoriesWithUser = categories.map(cat => ({ ...cat, userId }));

    // To ensure a full sync (including deletes) for THIS user, we need to find what's currently in DB for them
    // Use QueryCommand + UserIndex GSI instead of a full-table Scan
    const currentResponse = await docClient.send(new QueryCommand({
        TableName: CATEGORIES_TABLE,
        IndexName: "UserIndex",
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId },
        ProjectionExpression: "id" // Only fetch IDs — we only need them for diffing
    }));

    const existingIds = (currentResponse.Items || []).map(cat => cat.id);
    const incomingIds = new Set(categories.map(cat => cat.id));

    // IDs to delete: those in DB for this user but NOT in incoming
    const toDelete = existingIds.filter(id => !incomingIds.has(id));

    // Combine puts and deletes
    const allRequests = [
        ...categoriesWithUser.map(cat => ({ PutRequest: { Item: cat } })),
        ...toDelete.map(id => ({ DeleteRequest: { Key: { id } } }))
    ];

    if (allRequests.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ message: "No categories to save" }) };
    }

    const chunks = chunkArray(allRequests, 25);

    for (const chunk of chunks) {
        const command = new BatchWriteCommand({
            RequestItems: {
                [CATEGORIES_TABLE]: chunk,
            },
        });
        await docClient.send(command);
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "Categories synced successfully" }),
    };
}

// --- Sharing Functions ---

async function checkAccess(ownerId, requesterId) {
    const command = new QueryCommand({
        TableName: USER_SHARES_TABLE,
        KeyConditionExpression: "ownerId = :ownerId AND sharedWithId = :sharedWithId",
        ExpressionAttributeValues: {
            ":ownerId": ownerId,
            ":sharedWithId": requesterId
        }
    });
    const response = await docClient.send(command);
    return response.Items && response.Items.length > 0 && response.Items[0].status === "ACTIVE";
}

async function getMyShares(ownerId) {
    const command = new QueryCommand({
        TableName: USER_SHARES_TABLE,
        KeyConditionExpression: "ownerId = :ownerId",
        ExpressionAttributeValues: { ":ownerId": ownerId }
    });
    const response = await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ shares: response.Items }),
    };
}

async function getSharedWithMe(userId) {
    const sharedWithMe = await queryAllPages({
        TableName: USER_SHARES_TABLE,
        IndexName: "SharedWithIndex",
        KeyConditionExpression: "sharedWithId = :userId",
        ExpressionAttributeValues: { ":userId": userId }
    });

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ sharedWithMe }),
    };
}

async function createShare(ownerId, sharedWithId) {
    if (!sharedWithId) {
        return { statusCode: 400, headers, body: JSON.stringify({ message: "sharedWithId is required" }) };
    }
    if (ownerId === sharedWithId) {
        return { statusCode: 400, headers, body: JSON.stringify({ message: "You cannot share with yourself" }) };
    }

    const share = {
        ownerId,
        sharedWithId,
        permissions: "READ",
        status: "ACTIVE",
        createdAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({
        TableName: USER_SHARES_TABLE,
        Item: share
    }));

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "Share created successfully", share }),
    };
}

async function deleteShare(ownerId, sharedWithId) {
    await docClient.send(new DeleteCommand({
        TableName: USER_SHARES_TABLE,
        Key: { ownerId, sharedWithId }
    }));

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "Share removed successfully" }),
    };
}
