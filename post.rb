require 'rest_client'

post_url = 'http://localhost:3231/tasks.json'

File.open('submission.tar', 'r') do |tar_file|
  RestClient.post post_url, file: tar_file, notify: 'lolled', token: 'secret_token', docker_image: "nygrenh/sandbox-next-maven"
end
