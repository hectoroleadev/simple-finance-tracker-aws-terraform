const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand, DeleteCommand, QueryCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { z } = require("zod");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const ITEMS_TABLE = process.env.ITEMS_TABLE_NAME;
const HISTORY_TABLE = process.env.HISTORY_TABLE_NAME;
const CATEGORIES_TABLE = process.env.CATEGORIES_TABLE_NAME;

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
    const isHector = userId === 'hector';

    if (method === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    try {
        if (path === "/items" || path === "/items/") {
            if (method === "GET") {
                return await getItems(userId, isHector);
            } else if (method === "POST") {
                const body = JSON.parse(event.body);
                if (body.items) {
                    return await saveItems(body.items, userId);
                }
            }
        } else if (path.startsWith("/items/") && method === "DELETE") {
            const id = path.split("/").pop();
            if (id) {
                return await deleteItem(id, userId, isHector);
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ message: "Missing id in path" }),
                };
            }
        } else if (path === "/history") {
            if (method === "GET") {
                return await getHistory(userId, isHector);
            } else if (method === "POST") {
                const body = JSON.parse(event.body);
                if (body.history) {
                    return await saveHistory(body.history, userId);
                }
            }
        } else if (path.startsWith("/history/") && method === "DELETE") {
            const id = path.split("/").pop();
            if (id) {
                return await deleteHistoryItem(id, userId, isHector);
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
                return await getItemHistory(id, userId, isHector);
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ message: "Missing id in path" }),
                };
            }
        } else if (path === "/categories" || path === "/categories/") {
            if (method === "GET") {
                return await getCategories(userId, isHector);
            } else if (method === "POST") {
                const body = JSON.parse(event.body);
                if (body.categories) {
                    return await saveCategories(body.categories, userId, isHector);
                }
                return { statusCode: 400, headers, body: JSON.stringify({ message: "Missing categories in body" }) };
            }
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

async function getItems(userId, isHector) {
    const params = {
        TableName: ITEMS_TABLE,
        FilterExpression: isHector ? "userId = :uid OR attribute_not_exists(userId)" : "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId }
    };

    const command = new ScanCommand(params);
    const response = await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ items: response.Items }),
    };
}

async function getItemHistory(itemId, userId, isHector) {
    // First, verify the item belongs to the user
    const checkItemCommand = new QueryCommand({
        TableName: ITEMS_TABLE,
        KeyConditionExpression: "id = :id",
        ExpressionAttributeValues: { ":id": itemId }
    });
    const checkItemResponse = await docClient.send(checkItemCommand);
    const item = checkItemResponse.Items?.[0];

    if (!item || (item.userId !== userId && !(isHector && !item.userId))) {
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ message: "Forbidden: You do not have access to this item's history" })
        };
    }

    const command = new QueryCommand({
        TableName: process.env.ITEM_HISTORY_TABLE_NAME,
        KeyConditionExpression: "itemId = :itemId",
        ExpressionAttributeValues: {
            ":itemId": itemId
        },
        ScanIndexForward: false
    });
    const response = await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ history: response.Items }),
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

async function getHistory(userId, isHector) {
    const params = {
        TableName: HISTORY_TABLE,
        FilterExpression: isHector ? "userId = :uid OR attribute_not_exists(userId)" : "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId }
    };

    const command = new ScanCommand(params);
    const response = await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ history: response.Items }),
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

async function deleteItem(id, userId, isHector) {
    const command = new DeleteCommand({
        TableName: ITEMS_TABLE,
        Key: { id },
        ConditionExpression: isHector ? "userId = :uid OR attribute_not_exists(userId)" : "userId = :uid",
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

async function deleteHistoryItem(id, userId, isHector) {
    const command = new DeleteCommand({
        TableName: HISTORY_TABLE,
        Key: { id },
        ConditionExpression: isHector ? "userId = :uid OR attribute_not_exists(userId)" : "userId = :uid",
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

async function getCategories(userId, isHector) {
    const params = {
        TableName: CATEGORIES_TABLE,
        FilterExpression: isHector ? "userId = :uid OR attribute_not_exists(userId)" : "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId }
    };

    const command = new ScanCommand(params);
    const response = await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ categories: response.Items }),
    };
}

async function saveCategories(categories, userId, isHector) {
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
    const currentResponse = await docClient.send(new ScanCommand({
        TableName: CATEGORIES_TABLE,
        FilterExpression: isHector ? "userId = :uid OR attribute_not_exists(userId)" : "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId }
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
