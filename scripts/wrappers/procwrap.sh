#!/bin/bash

"$1" "${@:2}"
status=$?

if [ $status -ne 0 ]; then
    echo -e "\e[30;47m * \e[0m The process '$@' terminated with exit code: ${status}."
    echo -e "\e[30;47m * \e[0m Press any key to close this terminal"
    read -rsn1
fi

exit $status
