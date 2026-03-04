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
    const userClaims = event.requestContext?.authorizer?.claims; // Extract claims

    if (method === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    try {
        if (path === "/items" || path === "/items/") {
            if (method === "GET") {
                return await getItems();
            } else if (method === "POST") {
                const body = JSON.parse(event.body);
                if (body.items) {
                    return await saveItems(body.items);
                }
            }
        } else if (path.startsWith("/items/") && method === "DELETE") {
            const id = path.split("/").pop();
            if (id) {
                return await deleteItem(id);
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ message: "Missing id in path" }),
                };
            }
        } else if (path === "/history") {
            if (method === "GET") {
                return await getHistory();
            } else if (method === "POST") {
                const body = JSON.parse(event.body);
                if (body.history) {
                    return await saveHistory(body.history);
                }
            }
        } else if (path.startsWith("/history/") && method === "DELETE") {
            const id = path.split("/").pop();
            if (id) {
                return await deleteHistoryItem(id);
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
                return await getItemHistory(id);
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ message: "Missing id in path" }),
                };
            }
        } else if (path === "/categories" || path === "/categories/") {
            if (method === "GET") {
                return await getCategories();
            } else if (method === "POST") {
                const body = JSON.parse(event.body);
                if (body.categories) {
                    return await saveCategories(body.categories);
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

async function getItems() {
    const command = new ScanCommand({ TableName: ITEMS_TABLE });
    const response = await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ items: response.Items }),
    };
}

async function getItemHistory(itemId) {
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

async function saveItems(items) {
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

    // DynamoDB BatchWrite limit is 25
    const chunks = chunkArray(items, 25);

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

async function getHistory() {
    const command = new ScanCommand({ TableName: HISTORY_TABLE });
    const response = await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ history: response.Items }),
    };
}

async function saveHistory(historyEntries) {
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

    const chunks = chunkArray(historyEntries, 25);

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

async function deleteItem(id) {
    const command = new DeleteCommand({
        TableName: ITEMS_TABLE,
        Key: { id },
    });
    await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "Item deleted successfully" }),
    };
}

async function deleteHistoryItem(id) {
    const command = new DeleteCommand({
        TableName: HISTORY_TABLE,
        Key: { id },
    });
    await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "History item deleted successfully" }),
    };
}

// --- Categories ---

async function getCategories() {
    const command = new ScanCommand({ TableName: CATEGORIES_TABLE });
    const response = await docClient.send(command);
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ categories: response.Items }),
    };
}

async function saveCategories(categories) {
    const validation = z.array(CategorySchema).safeParse(categories);
    if (!validation.success) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ message: "Invalid categories format", errors: validation.error.format() }),
        };
    }

    // To ensure a full sync (including deletes), we need to find what's currently in DB
    const currentResponse = await docClient.send(new ScanCommand({ TableName: CATEGORIES_TABLE }));
    const existingIds = (currentResponse.Items || []).map(cat => cat.id);
    const incomingIds = new Set(categories.map(cat => cat.id));

    // IDs to delete: those in DB but NOT in incoming
    const toDelete = existingIds.filter(id => !incomingIds.has(id));

    // Combine puts and deletes
    const allRequests = [
        ...categories.map(cat => ({ PutRequest: { Item: cat } })),
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
