#!/bin/bash

# Update package list and install dependencies
sudo apt-get update && sudo apt-get install -y unzip curl

# Download AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"

# Unzip and install
unzip awscliv2.zip
sudo ./aws/install

# Verify installation
aws --version

# Cleanup
rm -rf aws awscliv2.zip

echo "AWS CLI installed successfully."
echo "Please run 'aws configure' to set up your credentials."
