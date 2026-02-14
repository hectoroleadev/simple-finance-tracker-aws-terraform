# Simple Finance Tracker - AWS Infrastructure

This project contains the Terraform configuration to deploy the serverless infrastructure for the Simple Finance Tracker application.

## Prerequisites

-   [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.0.0
-   [AWS CLI](https://aws.amazon.com/cli/) configured with your credentials.

### Installing AWS CLI on WSL (Ubuntu)

If you don't have the AWS CLI installed in WSL, run:

```sh
# Run from the project root inside WSL
bash install_aws_cli_wsl.sh
```

After installation, configure your credentials:

```sh
aws configure
```

> **Note:** When prompted for the region, enter `mx-central-1`.

### Getting your AWS Credentials

To get the `AWS Access Key ID` and `Secret Access Key`:

1.  Log in to the [AWS Management Console](https://console.aws.amazon.com/).
2.  Search for **IAM** in the top search bar and open it.
3.  Click on **Users** in the left sidebar -> **Create user**.
4.  Enter a user name (e.g., `terraform-admin`) and click **Next**.
5.  Select **Attach policies directly** and search for `AdministratorAccess`. Check the box and click **Next** -> **Create user**.
    > Note: `AdministratorAccess` grants full permissions. For production, limit permissions to only what is needed.
6.  Click on the newly created user's name.
7.  Go to the **Security credentials** tab.
8.  Scroll down to **Access keys** and click **Create access key**.
9.  Select **Command Line Interface (CLI)**, verify the check box, click **Next**, and then **Create access key**.
10. **Copy** the `Access key ID` and `Secret access key`. You will need these for the `aws configure` step.

### Installing Terraform on WSL (Ubuntu)

If you are using WSL, you can run the provided script to install Terraform:

```sh
# Run from the project root inside WSL
bash install_terraform_wsl.sh
```

Or manually:

1.  Update your system: `sudo apt-get update && sudo apt-get install -y gnupg software-properties-common`
2.  Add HashiCorp key: `wget -O- https://apt.releases.hashicorp.com/gpg | gpg --dearmor | sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg`
3.  Add repo: `echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list`
4.  Install: `sudo apt-get update && sudo apt-get install terraform`

## Project Structure

-   `modules/backend`: Contains API Gateway, Lambda, and IAM configurations.
-   `modules/database`: Contains DynamoDB table definitions.
-   `src/lambda`: source code for the Lambda function.

## Deployment

1.  Initialize Terraform:
    ```sh
    terraform init
    ```

2.  Plan the deployment:
    ```sh
    terraform plan -out=tfplan
    ```

3.  Apply the changes:
    ```sh
    terraform apply tfplan
    ```

4.  Note the **API Gateway URL** from the output.

## Integration with App

Update your `.env` file in the `simple-finance-tracker-app` with the API URL:

```env
VITE_API_URL=<api_gateway_url_from_terraform_output>
```
