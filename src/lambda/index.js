const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const ITEMS_TABLE = process.env.ITEMS_TABLE_NAME;
const HISTORY_TABLE = process.env.HISTORY_TABLE_NAME;

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

async function saveItems(items) {
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
